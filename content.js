chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    let article = document.querySelector('article');
    let body = document.querySelector('body');
    let title = document.title;  // ページのタイトルを取得
    if (article && article.innerText.length > 20) {
      sendResponse({text: article.innerText, title: title});
    } else if (body) {
      sendResponse({text: body.innerText, title: title});
    }
    return true;  // keeps the message channel open until sendResponse is called
  }
});

