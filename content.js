chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    let body = document.querySelector('body');
    if (body) {
      sendResponse({text: body.innerText});
    } else {
      sendResponse({text: ''});
    }
  }
});
