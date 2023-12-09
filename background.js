chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.sendMessage(
      request.tabId,
      { message: 'getArticleText' },
      response => {
        let now = new Date();  // Get the current date and time
        chrome.storage.sync.get(['apiKey'], async function(result) {
          let apiKey = result.apiKey;
          let summary = await callOpenAI(apiKey, response.text);
          let data = JSON.stringify({title: response.title, timestamp: now,summary: summary.choices[0].message.content, text: response.text});  // Store text, title, and timestamp in JSON
          console.log(data); 
          chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icon.png',  // Uncomment this line
              title: 'Retrieved Data',
              message: 'Your message here'  // Replace 'Your message here' with 'data'
            }); // Display the data in a notification
          // sendResponse({status: "success"});  // Send a response back
        });
      }
    );
  }
  return true;  // This is necessary as the response is sent asynchronously
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
