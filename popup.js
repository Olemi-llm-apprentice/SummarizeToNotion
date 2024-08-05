// パスワード表示/非表示の切り替え
document.querySelectorAll('.toggle-password').forEach(button => {
  button.addEventListener('click', function() {
    const targetId = this.getAttribute('data-target');
    const targetInput = document.getElementById(targetId);
    const icon = this.querySelector('i');

    if (targetInput.type === 'password') {
      targetInput.type = 'text';
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    } else {
      targetInput.type = 'password';
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  });
});

// APIKeyを保存
document.getElementById('save-credentials').addEventListener('click', function () {
  let apiKey = document.getElementById('api-key').value;
  let secretKey = document.getElementById('notion-secret-key').value;
  let databaseId = document.getElementById('notion-database-id').value;

  chrome.storage.sync.set(
    { apiKey: apiKey, secretKey: secretKey, databaseId: databaseId },
    function () {
      console.log('APIKey saved');
      alert('APIKey saved');
    }
  );
});

// Notionに登録
document.getElementById('get-text').addEventListener('click', function () {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.runtime.sendMessage(
      {
        message: 'getArticleText',
        tabId: tabs[0].id,
      },
      (response) => {
        console.log(response);
        if (response && response.success) {
          showNotification('処理を開始しました');
        }
      }
    );
  });
});

function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded shadow-lg';
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// 保存されたAPIKeyを読み込む
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