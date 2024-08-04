document.getElementById('get-text').addEventListener('click', function() {
  console.log('get-text button was clicked');
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.runtime.sendMessage({
      message: 'getArticleText',
      tabId: tabs[0].id
    }, response => {
      console.log(response);
      let text = response.text;
      if (text && text.length > 10000) {
        text = text.substring(0, 10000);  // Keep only the first 10000 characters
      }
      document.getElementById('article-text').innerText = text;
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

document.getElementById('save-notion-credentials').addEventListener('click', function() {
  let secretKey = document.getElementById('notion-secret-key').value;
  let databaseId = document.getElementById('notion-database-id').value;
  chrome.storage.sync.set({secretKey: secretKey, databaseId: databaseId}, function() {
    console.log('Notion credentials saved');
    document.getElementById('notion-secret-key').style.display = 'none';
    document.getElementById('notion-database-id').style.display = 'none';
    document.getElementById('save-notion-credentials').style.display = 'none';
  });
});

document.getElementById('check-api-key').addEventListener('click', function() {
  chrome.storage.sync.get(['apiKey', 'secretKey', 'databaseId'], function(result) {
    let alertMessage = '';
    if (result.apiKey) {
      alertMessage += "APIキーの最初の8文字: " + result.apiKey.substring(0, 8) + "\n";
    } else {
      alertMessage += "APIキーが保存されていません\n";
    }
    if (result.secretKey) {
      alertMessage += "Notionシークレットキーの最初の10文字: " + result.secretKey.substring(0, 10) + "\n";
    } else {
      alertMessage += "Notionシークレットキーが保存されていません\n";
    }
    if (result.databaseId) {
      alertMessage += "NotionデータベースID: " + result.databaseId + "\n";
    } else {
      alertMessage += "NotionデータベースIDが保存されていません\n";
    }
    alert(alertMessage);
  });
});

chrome.storage.sync.get(['apiKey', 'secretKey', 'databaseId'], function(result) {
  if (result.apiKey) {
    document.getElementById('api-key').style.display = 'none';
    document.getElementById('save-api-key').style.display = 'none';
  }
  if (result.secretKey && result.databaseId) {
    document.getElementById('notion-secret-key').style.display = 'none';
    document.getElementById('notion-database-id').style.display = 'none';
    document.getElementById('save-notion-credentials').style.display = 'none';
  }
});