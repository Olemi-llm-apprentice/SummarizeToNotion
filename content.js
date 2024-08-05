chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    let article = document.querySelector('article');
    let body = document.querySelector('body');
    let title = document.title;  // ページのタイトルを取得

    // Try to get the thumbnail image or the first image in the article
    let thumbnailImage = document.querySelector('meta[property="og:image"]');
    let firstImage = document.querySelector('img');

    let imageUrl = '';
    if (thumbnailImage && thumbnailImage.content) {
      imageUrl = thumbnailImage.content;
    } else if (firstImage && firstImage.src) {
      imageUrl = firstImage.src;
    }

    if (article && article.innerText.length > 20) {
      sendResponse({text: article.innerText, title: title, imageUrl: imageUrl});
    } else if (body) {
      sendResponse({text: body.innerText, title: title, imageUrl: imageUrl});
    }
    return true;  // keeps the message channel open until sendResponse is called
  }
});