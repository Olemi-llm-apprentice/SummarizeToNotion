chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.sendMessage(
      request.tabId,
      { message: 'getArticleText' },
      response => {
        console.log(response.text);
      }
    );
  }
});
