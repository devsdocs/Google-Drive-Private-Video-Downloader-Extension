document.addEventListener("DOMContentLoaded", () => {
    // ========== GOOGLE DRIVE TAB ==========
    const driveHeader = document.getElementById('drive-header');
    const notDriveMessage = document.getElementById('notDriveMessage');
    const downloadContainer = document.getElementById('downloadContainer');
    const statusMessage = document.getElementById('statusMessage');
    const btnOn = document.getElementById('btnOn');
    const btnOff = document.getElementById('btnOff');
    const reloadBtn = document.querySelector('.reload-btn');
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    function updateUI(isEnabled) {
        btnOn.disabled = isEnabled;
        btnOff.disabled = !isEnabled;
        reloadBtn.classList.toggle('active', isEnabled);
    }

    function handleStateChange(newState) {
        chrome.storage.local.set({ extensionEnabled: newState }, () => {
            updateUI(newState);

            if (!newState) {
                downloadContainer.innerHTML = '';
                statusMessage.textContent = "Extension stopped.";
                statusMessage.classList.remove('hidden');
                setTimeout(() => {
                    statusMessage.textContent = "";
                    statusMessage.classList.add('hidden');
                }, 2000);
            }

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;

                chrome.runtime.sendMessage({
                    type: "setEnabled",
                    enabled: newState,
                    tabId: tab.id,
                    url: tab.url
                }, (response) => {
                    if (newState && response?.success) {
                        chrome.tabs.reload(tab.id);
                    }
                });
            });
        });
    }

    // Check if current tab is Google Drive
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab) return;

        const isGoogleDrive = tab.url && tab.url.startsWith('https://drive.google.com/');

        // Google Drive handling
        if (isGoogleDrive) {
            driveHeader.classList.remove('hidden');
            downloadContainer.classList.remove('hidden');
            notDriveMessage.classList.add('hidden');

            chrome.storage.local.get(['extensionEnabled'], (result) => {
                const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : false;
                updateUI(isEnabled);
            });

            btnOn.addEventListener('click', () => handleStateChange(true));
            btnOff.addEventListener('click', () => handleStateChange(false));

            reloadBtn.addEventListener('click', () => {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0]?.id) {
                        chrome.tabs.reload(tabs[0].id);
                    }
                });
            });

            const activeTabId = tab.id;
            setInterval(() => {
                chrome.runtime.sendMessage({ type: "getRequests" }, (response) => {
                    if (response && response.requests) {
                        const matchingRequests = [];
                        for (const requestId in response.requests) {
                            const req = response.requests[requestId];
                            if (req.tabId === activeTabId && req.lastItagUrl && req.videoTitle) {
                                matchingRequests.push(req);
                            }
                        }
                        if (matchingRequests.length > 0) {
                            statusMessage.textContent = "";
                            statusMessage.classList.add('hidden');
                            downloadContainer.innerHTML = "";
                            document.getElementById('downloadSummary').textContent = `${matchingRequests.length} ready to download`;
                            document.getElementById('downloadSummary').classList.remove('hidden');
                            downloadAllBtn.classList.remove('hidden');

                            matchingRequests.forEach((req) => {
                                const item = document.createElement("div");
                                item.classList.add("video-item");

                                const titleSpan = document.createElement("span");
                                titleSpan.classList.add("video-title");
                                titleSpan.textContent = req.videoTitle.length > 45
                                    ? req.videoTitle.substring(0, 45) + "..."
                                    : req.videoTitle;
                                titleSpan.title = req.videoTitle;

                                const btn = document.createElement("button");
                                btn.classList.add("download-btn");
                                btn.innerHTML = "⬇";
                                btn.addEventListener("click", () => {
                                    chrome.runtime.sendMessage({
                                        type: "downloadVideo",
                                        url: req.lastItagUrl,
                                        filename: req.videoTitle
                                    }, (response) => {
                                        if (chrome.runtime.lastError || !response?.success) {
                                            statusMessage.textContent = "❌ Download error";
                                            statusMessage.classList.add('error', 'hidden');
                                            statusMessage.classList.remove('hidden');
                                        } else {
                                            statusMessage.textContent = "✓ Download started!";
                                            statusMessage.classList.remove('error', 'hidden');
                                            setTimeout(() => {
                                                statusMessage.classList.add('hidden');
                                            }, 2000);
                                        }
                                    });
                                });

                                item.appendChild(titleSpan);
                                item.appendChild(btn);
                                downloadContainer.appendChild(item);
                            });

                            // Download All button event listener
                            downloadAllBtn.onclick = () => {
                                downloadAllBtn.disabled = true;
                                statusMessage.textContent = "⬇ Downloading all videos...";
                                statusMessage.classList.remove('error', 'hidden');
                                let downloadCount = 0;
                                let totalCount = matchingRequests.length;

                                matchingRequests.forEach((req, index) => {
                                    setTimeout(() => {
                                        chrome.runtime.sendMessage({
                                            type: "downloadVideo",
                                            url: req.lastItagUrl,
                                            filename: req.videoTitle
                                        }, (response) => {
                                            downloadCount++;
                                            if (downloadCount === totalCount) {
                                                statusMessage.textContent = `✓ All ${totalCount} video(s) download started!`;
                                                downloadAllBtn.disabled = false;
                                                setTimeout(() => {
                                                    statusMessage.classList.add('hidden');
                                                }, 2000);
                                            }
                                        });
                                    }, index * 50);
                                });
                            };
                        } else {
                            downloadAllBtn.classList.add('hidden');
                            document.getElementById('downloadSummary').classList.add('hidden');
                            chrome.storage.local.get(['extensionEnabled'], (result) => {
                                if (result.extensionEnabled) {
                                    statusMessage.textContent = "Waiting for video source... If not working reload the page.";
                                    statusMessage.classList.remove('hidden');
                                }
                            });
                        }
                    }
                });
            }, 500);
        } else {
            driveHeader.classList.add('hidden');
            downloadContainer.classList.add('hidden');
            notDriveMessage.classList.remove('hidden');
        }
    });
});