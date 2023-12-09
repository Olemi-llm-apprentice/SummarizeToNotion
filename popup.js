document.getElementById('get-text').addEventListener('click', function() {
  console.log('get-text button was clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({
      message: 'getArticleText',
      tabId: tabs[0].id
    }, response => {
      console.log(response);
      document.getElementById('article-text').innerText = response.text;
      document.getElementById('article-title').innerText = response.title;
      alert(JSON.stringify(data, null, 2));  // Change this line
    });
  });
});

document.getElementById('save-api-key').addEventListener('click', function() {
  let apiKey = document.getElementById('api-key').value;
  chrome.storage.sync.set({apiKey: apiKey}, function() {
    console.log('API key is saved');
    document.getElementById('api-key').style.display = 'none';
    document.getElementById('save-api-key').style.display = 'none';
    alert("APIキーの最初の8文字: " + apiKey.substring(0, 8));  // APIキーの最初の8文字を表示
  });
});

document.getElementById('check-api-key').addEventListener('click', function() {
  chrome.storage.sync.get(['apiKey'], function(result) {
    if (result.apiKey) {
      alert("APIキーの最初の8文字: " + result.apiKey.substring(0, 8));
    } else {
      alert("APIキーが保存されていません");
    }
  });
});

chrome.storage.sync.get(['apiKey'], function(result) {
  if (result.apiKey) {
    document.getElementById('api-key').style.display = 'none';
    document.getElementById('save-api-key').style.display = 'none';
  }
});

window.onload = function() {
  document.getElementById('check-api-key').addEventListener('click', function() {
    chrome.storage.sync.get(['apiKey'], function(result) {
      if (result.apiKey) {
        alert("APIキーの最初の8文字: " + result.apiKey.substring(0, 8));
      } else {
        alert("APIキーが保存されていません");
      }
    });
  });
};