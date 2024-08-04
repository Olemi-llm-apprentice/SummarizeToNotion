document.getElementById('get-text').addEventListener('click', function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage(
      {
        message: 'getArticleText',
        tabId: tabs[0].id,
      },
      (response) => {
        console.log(response);
      }
    );
  });
});

document.getElementById('save-credentials').addEventListener('click', function () {
  let apiKey = document.getElementById('api-key').value;
  let secretKey = document.getElementById('notion-secret-key').value;
  let databaseId = document.getElementById('notion-database-id').value;

  chrome.storage.sync.set(
    { apiKey: apiKey, secretKey: secretKey, databaseId: databaseId },
    function () {
      console.log('Credentials saved');
      alert('Credentials saved');
    }
  );
});

// ページ読み込み時に、保存されたクレデンシャルを表示
chrome.storage.sync.get(['apiKey', 'secretKey', 'databaseId'], function (result) {
  if (result.apiKey) {
    document.getElementById('api-key').value = result.apiKey;
  }
  if (result.secretKey) {
    document.getElementById('notion-secret-key').value = result.secretKey;
  }
  if (result.databaseId) {
    document.getElementById('notion-database-id').value = result.databaseId;
  }
});