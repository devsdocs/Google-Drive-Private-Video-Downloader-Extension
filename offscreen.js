chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Offscreen received message:', message);
    if (message.type === "downloadVideo") {
        downloadVideo(message.url, message.filename)
            .then(() => {
                console.log('Download successful');
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error('Download error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

async function downloadVideo(url, filename) {
    try {
        console.log('Starting download:', url, filename);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const reader = response.body.getReader();
        const chunks = [];
        let totalSize = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            totalSize += value.length;
            
            // Send progress update
            chrome.runtime.sendMessage({
                type: "downloadProgress",
                filename: filename,
                downloaded: totalSize
            });
        }
        
        console.log('Download complete, size:', totalSize);
        const blob = new Blob(chunks);
        const blobUrl = URL.createObjectURL(blob);
        
        // Download using chrome.downloads API with blob URL
        const downloadId = await chrome.downloads.download({
            url: blobUrl,
            filename: sanitizeFilename(filename) + '.mp4'
        });
        
        console.log('Download started with ID:', downloadId);
        
        // Clean up blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        
    } catch (error) {
        console.error('Download error:', error);
        throw error;
    }
}

function sanitizeFilename(filename) {
    // Remove invalid characters from filename
    return filename.replace(/[<>:"/\\|?*]/g, '').trim();
}
