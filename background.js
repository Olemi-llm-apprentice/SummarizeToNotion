chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.sendMessage(
      request.tabId,
      { message: 'getArticleText' },
      response => {
        console.log(response.text);
        console.log(response.title);  // Log the title
        let data = JSON.stringify({text: response.text, title: response.title});  // Store text and title in JSON
      }
    );
  }
});
