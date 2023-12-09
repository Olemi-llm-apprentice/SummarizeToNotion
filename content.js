chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    let article = document.querySelector('article');
    if (article) {
      sendResponse({text: article.innerText});
    } else {
      sendResponse({text: ''});
    }
  }
});
