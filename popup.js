document.getElementById('get-text').addEventListener('click', function() {
  console.log('get-text button was clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({
      message: 'getArticleText',
      tabId: tabs[0].id
    }, response => {
      console.log(response.text);
    });
  });
});