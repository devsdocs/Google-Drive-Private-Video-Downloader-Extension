let capturedRequests = {};
let pollingTimers = {};
let extensionEnabled = false;
const pendingTabs = new Set();

chrome.storage.local.get(['extensionEnabled'], (result) => {
    extensionEnabled = result.extensionEnabled || false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Ignore messages from offscreen document to prevent loops
    if (sender.url && sender.url.includes('offscreen.html')) {
        return false;
    }

    if (message.type === "setEnabled") {
        extensionEnabled = message.enabled;

        if (message.enabled) {
            chrome.tabs.get(message.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false });
                    return;
                }
                if (tab.url?.includes("drive.google.com")) {
                    startAutoCaptureForTab(message.tabId);
                    pendingTabs.add(message.tabId);
                }
                sendResponse({ success: true });
            });
            return true;
        } else {
            capturedRequests = {};
            pendingTabs.clear();

            Object.keys(pollingTimers).forEach(tabId => {
                cleanupTabResources(Number(tabId));
            });
            sendResponse({ success: true });
        }
        return true;
    }
    if (message.type === "getRequests") {
        sendResponse({ requests: capturedRequests });
    }
    if (message.type === "getTabId") {
        sendResponse({ tabId: sender.tab.id });
    }
    if (message.type === "downloadVideo") {
        console.log('Background received downloadVideo request:', message);
        // Start download asynchronously without waiting for response
        downloadVideoDirect(message.url, message.filename)
            .then(() => {
                console.log('Download successful');
            })
            .catch((error) => {
                console.error('Download error:', error);
            });
        // Send immediate response
        sendResponse({ success: true });
        return false;
    }
});

function cleanupTabResources(tabId) {
    console.log('Cleaning up resources for tab:', tabId);
    if (pollingTimers[tabId]) {
        clearInterval(pollingTimers[tabId]);
        delete pollingTimers[tabId];
    }
    const debuggee = { tabId: tabId };
    chrome.debugger.detach(debuggee, () => {
        if (chrome.runtime.lastError) {
            console.log('Debugger detach error (expected):', chrome.runtime.lastError);
            return;
        }

        Object.keys(capturedRequests).forEach(requestId => {
            if (capturedRequests[requestId].tabId === tabId) {
                delete capturedRequests[requestId];
            }
        });
    });
    pendingTabs.delete(tabId);
}

function startAutoCaptureForTab(tabId) {
    console.log('Starting auto capture for tab:', tabId);
    cleanupTabResources(tabId);

    const debuggee = { tabId: tabId };
    chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) {
            console.error('Debugger attach error:', chrome.runtime.lastError);
            return;
        }
        console.log('Debugger attached successfully to tab:', tabId);

        chrome.debugger.sendCommand(debuggee, "Network.enable", {}, () => {
            if (chrome.runtime.lastError) {
                console.error('Network.enable error:', chrome.runtime.lastError);
                return;
            }
            console.log('Network enabled for tab:', tabId);
            pollingTimers[tabId] = setInterval(() => {
                let validRequests = [];
                for (const requestId in capturedRequests) {
                    const req = capturedRequests[requestId];
                    if (req.tabId === tabId && req.lastItagUrl && req.videoTitle) {
                        validRequests.push(req);
                    }
                }
            }, 500);
        });
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log('Tab updated:', tabId, changeInfo.status, tab.url);
    if (changeInfo.status === "complete" && tab.url?.startsWith("https://drive.google.com/")) {
        console.log('Drive page loaded, extensionEnabled:', extensionEnabled, 'pendingTabs:', pendingTabs.has(tabId));
        if (extensionEnabled || pendingTabs.has(tabId)) {
            if (!pollingTimers[tabId]) {
                startAutoCaptureForTab(tabId);
            }
            pendingTabs.delete(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabResources(tabId);
});

chrome.debugger.onEvent.addListener((debuggeeId, method, params) => {
    const tabId = debuggeeId.tabId;
    console.log('Debugger event:', method, 'tabId:', tabId, 'extensionEnabled:', extensionEnabled);
    if (!extensionEnabled && !pendingTabs.has(tabId)) return;

    if (method === "Network.requestWillBeSent") {
        if (params.request.url.startsWith("https://workspacevideo-pa.clients6.google.com")) {
            console.log('Captured video request:', params.request.url);
            const requestId = params.requestId;
            capturedRequests[requestId] = {
                url: params.request.url,
                method: params.request.method,
                timestamp: params.timestamp,
                tabId: tabId
            };
        }
    } else if (method === "Network.responseReceived") {
        const requestId = params.requestId;
        if (capturedRequests[requestId]) {
            console.log('Got response for request:', requestId);
            chrome.debugger.sendCommand(
                { tabId: tabId },
                "Network.getResponseBody",
                { requestId: requestId },
                (result) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error getting response body:', chrome.runtime.lastError);
                        return;
                    }
                    capturedRequests[requestId].responseBody = result.body;
                    capturedRequests[requestId].base64Encoded = result.base64Encoded;
                    try {
                        const data = JSON.parse(result.body);
                        if (data.mediaStreamingData?.formatStreamingData?.progressiveTranscodes) {
                            const transcodes = data.mediaStreamingData.formatStreamingData.progressiveTranscodes;
                            capturedRequests[requestId].lastItagUrl = transcodes[transcodes.length - 1]?.url;
                            console.log('Found video URL:', capturedRequests[requestId].lastItagUrl);
                        }
                        if (data.mediaMetadata?.title) {
                            capturedRequests[requestId].videoTitle = data.mediaMetadata.title;
                            console.log('Found video title:', capturedRequests[requestId].videoTitle);
                        }
                    } catch (e) {
                        console.error('Error parsing response:', e);
                    }
                }
            );
        }
    }
});

function detectSource(url) {
    if (url.includes('youtube') || url.includes('googlevideo')) {
        return 'youtube';
    } else if (url.includes('facebook') || url.includes('fbcdn')) {
        return 'facebook';
    }
    return 'unknown';
}

async function downloadVideoDirect(url, filename) {
    try {
        console.log('Starting download:', url, filename);
        
        // Download directly using chrome.downloads API
        const downloadId = await chrome.downloads.download({
            url: url,
            filename: sanitizeFilename(filename) + '.mp4'
        });
        
        console.log('Download started with ID:', downloadId);
        
    } catch (error) {
        console.error('Download error:', error);
        throw error;
    }
}

function sanitizeFilename(filename) {
    // Remove invalid characters from filename
    return filename.replace(/[<>:"/\\|?*]/g, '').trim();
}

async function setupOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });

    if (existingContexts.length > 0) {
        return;
    }

    await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['BLOBS'],
        justification: 'Download video files using fetch API for better performance'
    });
}