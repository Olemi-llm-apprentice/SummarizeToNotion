chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      let url = tabs[0].url;  // Get the URL of the current tab
      chrome.tabs.sendMessage(
        request.tabId,
        { message: 'getArticleText' },
        response => {
          let now = new Date();  // Get the current date and time
          chrome.storage.sync.get(['apiKey'], async function(result) {
            let apiKey = result.apiKey;
            let text = response.text;
            if (text && text.length > 10000) {
              text = text.substring(0, 10000);  // Keep only the first 10000 characters
            }
            let summary = await callOpenAI(apiKey, text);
            let data = JSON.stringify({title: response.title, timestamp: now, url: url, summary: summary.choices[0].message.content, text: text});  // Add URL to the JSON
            console.log(data); 
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Retrieved Data',
                message: 'Your message here'
              });
          });
        }
      );
    });
  }
  return true;
});

async function callOpenAI(apiKey, text) {
  let response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo-1106',
      messages: [
        {"role": "system", "content":"以下の文章を要約してください"},
        {"role": "user", "content": text}],
      max_tokens: 1000,
      temperature: 0
    })
  });
  let summary = await response.json();
  return summary;
}
