chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'getArticleText') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        console.error('アクティブなタブが見つかりません');
        sendResponse({ error: 'アクティブなタブが見つかりません' });
        return;
      }

      let url = tabs[0].url;
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: getPageContent,
        },
        async (results) => {
          if (chrome.runtime.lastError) {
            console.error('スクリプト実行エラー:', chrome.runtime.lastError);
            sendResponse({ error: 'スクリプトの実行に失敗しました' });
          } else if (results && results[0]) {
            const result = await results[0].result;
            showNotification('記事の処理を開始しました');
            sendResponse({ success: true });
            processArticleData(result, url);
          } else {
            console.error('無効な結果:', results);
            sendResponse({ error: '無効な結果を受信しました' });
          }
        }
      );
    });
    return true;
  }
});

async function getPageContent() {
  const title = document.title;
  let text = '';
  let images = [];

  function extractImages(element) {
    const imageElements = Array.from(element.querySelectorAll('img'));
    return imageElements.filter(img => {
      // 画像が完全にロードされているか確認
      if (img.complete) {
        return img.naturalWidth >= 500 && img.naturalHeight >= 500;
      } else {
        // 画像がまだロードされていない場合、src属性のサイズを確認
        const tempImg = new Image();
        tempImg.src = img.src;
        return new Promise((resolve) => {
          tempImg.onload = () => {
            resolve(tempImg.naturalWidth >= 500 && tempImg.naturalHeight >= 500);
          };
          tempImg.onerror = () => {
            resolve(false);
          };
        });
      }
    }).map(img => img.src);
  }

  function extractMainContent(element) {
    // 不要な要素を除外
    const excludeSelectors = 'header, footer, nav, aside, script, style';
    const excludeElements = element.querySelectorAll(excludeSelectors);
    excludeElements.forEach(el => el.remove());

    // 残りのテキストを取得
    return element.innerText;
  }

  // まず、articleタグを探す
  const article = document.querySelector('article');

  if (article) {
    text = article.innerText;
    images = await extractImages(article);
  } else {
    // articleタグがない場合、body全体から抽出
    const body = document.body;
    text = extractMainContent(body);
    images = await extractImages(body);
  }

  if (text) {
    return { text: text, title: title, images: images };
  } else {
    return { error: 'テキストを取得できませんでした' };
  }
}

async function processArticleData(response, url) {
  console.log('processArticleData開始:', JSON.stringify({ response, url }, null, 2));
  if (!response || !response.text) {
    console.error('無効な応答:', JSON.stringify(response, null, 2));
    showNotification('記事のテキストを取得できませんでした');
    return;
  }

  let now = new Date();
  try {
    let { apiKey, secretKey, databaseId } = await getCredentials();
    console.log('クレデンシャル取得成功');
    let text = response.text.substring(0, 100000);
    let summary = await callOpenAI(apiKey, text);
    console.log('OpenAI呼び出し成功');
    let tags = await generateTags(apiKey, summary.choices[0].message.content);
    console.log('タグ生成成功');

    // 画像URLの検証
    let validImages = await validateImages(response.images);
    console.log('有効な画像URL:', validImages);

    let data = JSON.stringify({
      properties: {
        タイトル: { title: [{ text: { content: response.title } }] },
        URL: { url: url },
        要約内容: { rich_text: [{ text: { content: summary.choices[0].message.content } }] },
        タグ: { multi_select: tags.map(tag => ({ name: tag })) },
        作成日: { date: { start: now.toISOString() } },
        セレクト: { select: { name: '未読' } },
        テキスト: { rich_text: [{ text: { content: text } }] },
      },
      images: validImages, // 検証済みの画像URLを使用
    });

    await addRecordToNotionDatabase(data, secretKey, databaseId, url, tags, now, text);
    console.log('Notionデータベースに追加成功');
    showNotification('登録が完了しました');
  } catch (error) {
    console.error('記事データの処理中にエラーが発生しました:', error);
    showNotification('エラーが発生しました: ' + error.message);
  }
}

async function validateImages(images) {
  let validImages = [];
  for (let imageUrl of images) {
    try {
      // URLの形式を確認
      const url = new URL(imageUrl);
      // HTTPSのみを許可
      if (url.protocol !== 'https:') {
        console.warn('Invalid image URL protocol:', imageUrl);
        continue;
      }

      const response = await fetch(imageUrl, { method: 'HEAD' });
      if (response.ok && response.headers.get('content-type').startsWith('image/')) {
        validImages.push(imageUrl);
      } else {
        console.warn('Invalid image URL or content type:', imageUrl);
      }
    } catch (error) {
      console.warn('Error validating image URL:', imageUrl, error);
    }
  }
  return validImages;
}

async function addRecordToNotionDatabase(data, secretKey, databaseId, url, tags, now, text) {
  const parsedData = JSON.parse(data);

  let children = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '要約' } }]
      }
    },
    ...splitTextIntoParagraphs(parsedData.properties.要約内容.rich_text[0].text.content),
    {
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '本文' } }]
      }
    },
    ...splitTextIntoParagraphs(text)
  ];

  // 画像ブロックを追加
  if (parsedData.images && parsedData.images.length > 0) {
    for (const imageUrl of parsedData.images) {
      children.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: {
            url: imageUrl
          }
        }
      });
    }
  }

  try {
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          タイトル: { title: [{ text: { content: parsedData.properties.タイトル.title[0].text.content } }] },
          URL: { url: url },
          タグ: { multi_select: tags.map(tag => ({ name: tag })) },
          作成日: { date: { start: now.toISOString() } },
          セレクト: { select: { name: '未読' } },
        },
        children: children
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API error: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Notionデータベースへの追加中にエラーが発生しました:', error);
    // エラーが発生した場合、画像ブロックをテキストに変換して再試行
    children = children.map(block => {
      if (block.type === 'image') {
        return {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: `画像URL: ${block.image.external.url}` } }]
          }
        };
      }
      return block;
    });

    const retryResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          タイトル: { title: [{ text: { content: parsedData.properties.タイトル.title[0].text.content } }] },
          URL: { url: url },
          タグ: { multi_select: tags.map(tag => ({ name: tag })) },
          作成日: { date: { start: now.toISOString() } },
          セレクト: { select: { name: '未読' } },
        },
        children: children
      })
    });

    if (!retryResponse.ok) {
      const retryErrorText = await retryResponse.text();
      throw new Error(`Retry Notion API error: ${retryResponse.status} ${retryErrorText}`);
    }

    return await retryResponse.json();
  }
}

async function getCredentials() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey', 'secretKey', 'databaseId'], (result) => {
      if (result.apiKey && result.secretKey && result.databaseId) {
        resolve(result);
      } else {
        reject(new Error('APIキー、Notion Secret Key、またはDatabase IDが設定されていません'));
      }
    });
  });
}

async function callOpenAI(apiKey, text, purpose = 'summarize') {
  let prompt = '';
  if (purpose === 'summarize') {
    prompt = `
      /*
      以下の記事を要約し、日本語で記述してください。

      * 要約: 重要なポイントを網羅し、読みやすく簡潔な文章で表現してください。Notion用の記法で出力してください。
      * 翻訳: 元の記事が日本語でない場合は、要約の下に原文を日本語に翻訳した文章を続けて出力してください。翻訳は正確さを重視してください。

      記事:
      */
    `;
  } else if (purpose === 'generateTags') {
    prompt = '以下の文章から関連するタグを5つ、日本語でカンマ区切りで出力してください';
  }

  let response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-2024-07-18',
      messages: [
        { role: 'system', 'content': prompt },
        { role: 'user', 'content': text },
      ],
      max_tokens: 16000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API Error: ${response.status}`);
  }

  return await response.json();
}

async function generateTags(apiKey, text) {
  let response = await callOpenAI(apiKey, text, 'generateTags');
  let tags = response.choices[0].message.content.split(',').map((tag) => tag.trim());
  return tags;
}

function splitTextIntoParagraphs(text) {
  const paragraphs = [];
  const MAX_LENGTH = 2000;

  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    paragraphs.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: text.substring(i, i + MAX_LENGTH) } }]
      }
    });
  }

  return paragraphs;
}

function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'Summarize To Notion',
    message: message
  });
}