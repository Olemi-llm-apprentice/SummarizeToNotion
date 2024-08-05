chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    let article = document.querySelector('article');
    let body = document.querySelector('body');
    let title = document.title;

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
    } else {
      sendResponse({error: 'No suitable content found'});  // Send an error response
    }
    return true;  // keeps the message channel open until sendResponse is called
  }
});

async function callOpenAI(apiKey, text) {
  const json_prompt = ```
  {
    "要約内容": "この記事では、人工知能の最新トレンドとして、ニューラルネットワークとシンボリックAIの融合に焦点を当てています。具体的には、ハイブリッドAIシステムの構築方法、それらが現在の技術環境にどのように適合するか、および将来のAI研究におけるその潜在的な影響について論じています。",
    "タグ": ["人工知能", "ニューラルネットワーク", "シンボリックAI", "ハイブリッドAI", "技術トレンド"],
    "マーメイド": "graph TD\n    AI[人工知能の最新トレンド] --> NN[ニューラルネットワークとシンボリックAIの融合]\n    NN --> HybridAI[ハイブリッドAIシステムの構築]\n    NN --> Adaptation[技術環境への適合性]\n    NN --> FutureImpact[将来のAI研究への影響]"
  }```
  const prompt = ```以下の文章を要約し、jsonモードで出力してください
  jsonの出力は「要約内容」,「タグ」,「マーメイド」を項目とし、それぞれにサンプルでありそうな文章を入れてください。
  - 「要約内容」：そのページの本文の要約内容
  - 「タグ」:その本文のジャンルやタグを５つ選定する。Notionのマルチセレクトに入力するもの
  - 「マーメイド」:本文の構成からマークダウン形式でマーメイド図を生成する。
  # 出力例
  ${json_prompt}

  # テキスト本文
  ```
  let response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4-turbo-preview',
      messages: [
        {"role": "system", "content":prompt},
        {"role": "user", "content": text}],
      // max_tokens: 2000,
      temperature: 0.2
    })
  });
  let summary = await response.json();
  return summary;
}

async function addRecordToNotionDatabase(data) {
  chrome.storage.sync.get(['secretKey', 'databaseId'], async function(notionResult) {
    let secretKey = notionResult.secretKey;
    let databaseId = notionResult.databaseId;
    let parsedData = JSON.parse(data);

    if (!parsedData.title) {
      console.error('Title is missing in the data object');
      return;
    }

    let text = parsedData.text;
    if (text && text.length > 2000) {
      text = text.substring(0, 2000);  // Keep only the first 2000 characters
    }

    let summaryContent = '';
    try {
      let summaryJson = JSON.parse(parsedData.summary);
      if (parsedData.imageUrl) {
        summaryContent += `<img src="${parsedData.imageUrl}" alt="Article Image" />\n\n`;
      }
      summaryContent += summaryJson['要約内容'];
    } catch (error) {
      console.error('Error parsing summary JSON:', error);
      summaryContent = parsedData.summary;
    }

    let response = await fetch(`https://api.notion.com/v1/pages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          タイトル: { title: [{ text: { content: parsedData.title } }] },
          作成日: { date: { start: parsedData.timestamp, end: null } },
          要約内容: { rich_text: [{ text: { content: summaryContent } }] },
          URL: { url: parsedData.url },
          // テキスト: { rich_text: [{ text: { content: text } }] },
          マインドマップ: { rich_text: [{ text: { content: summaryJson['マインドマップ'] } }] },
          マーメイド: { rich_text: [{ text: { content: summaryJson['マーメイド'] } }] },
          セレクト: { multi_select: summaryJson['タグ'].map(tag => ({ name: tag })) }
        }
      })
    });

    let result = await response.json();
    console.log(result);
    alert('登録が完了しました');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '通知',
      message: '登録が完了しました'
    });
  });
}