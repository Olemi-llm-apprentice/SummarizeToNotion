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

      * 要約: 重要なポイントを網羅し、読みやすく簡潔な文章で表現してください。以下のNotionリッチテキストの記述に沿った記法で出力してください。
      ====
リッチテキスト
Notionはリッチテキストを使用して、ユーザーがコンテンツをカスタマイズできるようにします。リッチテキストとは、カスタマイズ可能なさまざまな方法でコンテンツのスタイル設定やフォーマットが可能なタイプのドキュメントを指します。これには、イタリック体、フォント サイズ、フォントの色の使用などのスタイル設定の決定や、ハイパーリンクやコード ブロックの使用などの書式設定が含まれます。

Notionは、ページ内のブロックがどのように表現されるかを示すために、ブロックオブジェクトにリッチテキストオブジェクトを含めます。リッチ テキストをサポートするブロックには、リッチ テキスト オブジェクトが含まれます。ただし、すべてのブロックタイプがリッチテキストを提供するわけではありません。

「ブロックの取得」または「ブロックの子の取得」エンドポイントを使用してページからブロックを取得すると、リッチテキストオブジェクトの配列がブロックオブジェクトに含まれます(使用可能な場合)。開発者は、この配列を使用して、ブロックのプレーン テキスト () を取得したり、ブロックに適用されているすべてのリッチ テキスト スタイルと書式設定オプションを取得したりできます。plain_text

リッチテキストオブジェクトの例

{
  "type": "text",
  "text": {
    "content": "Some words ",
    "link": null
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "Some words ",
  "href": null
}
📘
多くのブロックタイプはリッチテキストをサポートしています。サポートされている場合、オブジェクトはブロックオブジェクトに含まれます。すべてのオブジェクトにはプロパティが含まれており、開発者はNotionブロックからフォーマットされていないテキストにアクセスするのに便利です。rich_texttyperich_textplain_text

各リッチテキストオブジェクトには、次のフィールドが含まれています。

畑	種類	形容	値の例
type	string(列挙型)	このリッチテキストオブジェクトのタイプ。指定できる型の値は、、です。"text""mention""equation"	"text"
text| |mentionequation	object	タイプ固有の設定を含むオブジェクト。

タイプ固有の値の詳細については、以下のリッチテキストタイプオブジェクトのセクションを参照してください。	例については、以下のリッチテキストタイプのオブジェクトのセクションを参照してください。
annotations	object	リッチテキストオブジェクトのスタイル設定に使用される情報。詳細については、以下の注釈オブジェクトのセクションを参照してください。	例については、以下の注釈オブジェクトのセクションを参照してください。
plain_text	string	注釈のないプレーンテキスト。	"Some words "
href	string(オプション)	このテキストで言及されているリンクまたはNotionのURL(存在する場合)。	"https://www.notion.so/Avocado-d093f1d200464ce78b36e58a3f0d8043"
注釈オブジェクト
すべてのリッチテキストオブジェクトには、リッチテキストのスタイルを設定するオブジェクトが含まれています。 次のフィールドが含まれます。annotationsannotations

財産	種類	形容	値の例
bold	boolean	テキストを太字にするかどうか。	true
italic	boolean	テキストが斜体かどうか。	true
strikethrough	boolean	テキストに取り消し線が引かれているかどうか。	false
underline	boolean	テキストに下線を付けるかどうか。	false
code	boolean	テキストが .code style	true
color	string(列挙型)	テキストの色。可能な値は次のとおりです。

- "blue"
- "blue_background"
- "brown"
- "brown_background"
- "default"
- "gray"
- "gray_background"
- "green"
- "green_background"
- "orange"
-"orange_background"
- "pink"
- "pink_background"
- "purple"
- "purple_background"
- "red"
- "red_background”
- "yellow"
- "yellow_background"	"green"
リッチテキストタイプオブジェクト
方程式
Notionは、インラインLaTeX方程式を、タイプ値を持つリッチテキストオブジェクトとしてサポートしています。対応する方程式タイプオブジェクトには、次のものが含まれます。"equation"

畑	種類	形容	値の例
expression	string	インライン方程式を表す LaTeX 文字列。	"\frac{{ - b \pm \sqrt {b^2 - 4ac} }}{{2a}}"
リッチテキストオブジェクトの例equation
JSONの

{
  "type": "equation",
  "equation": {
    "expression": "E = mc^2"
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "E = mc^2",
  "href": null
}
言及
メンションオブジェクトは、データベース、日付、リンクプレビューメンション、ページ、テンプレートメンション、またはユーザーのインラインメンションを表します。NotionのUIでは、ユーザーが参照の名前を入力すると、メンションが作成されます。@

リッチテキストオブジェクトの値が の場合、対応するオブジェクトには次のものが含まれます。type"mention"mention

畑	種類	形容	値の例
type	string(列挙型)	インライン メンションのタイプ。可能な値は次のとおりです。

- "database"
- "date"
- "link_preview"
- "page"
- "template_mention"
- "user"	"user"
database| | | | |datelink_previewpagetemplate_mentionuser	object	タイプ固有の設定を含むオブジェクト。詳細については、以下のメンションタイプオブジェクトのセクションを参照してください。	値の例については、以下のメンションタイプオブジェクトのセクションを参照してください。
データベースメンションタイプオブジェクト
データベース・メンションには、対応するフィールド内にデータベース参照が含まれます。データベース参照は、データベース ID に対応するキーと文字列値 (UUIDv4) を持つオブジェクトです。databaseid

インテグレーションがメンションされたデータベースにアクセスできない場合、メンションはIDのみで返されます。タイトルとなる値は と表示され、注釈オブジェクトの値はデフォルトです。plain_text"Untitled"

メンションのリッチテキストオブジェクトの例mentiondatabase

JSONの

{
  "type": "mention",
  "mention": {
    "type": "database",
    "database": {
      "id": "a1d8501e-1ac1-43e9-a6bd-ea9fe6c8822b"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "Database with test things",
  "href": "https://www.notion.so/a1d8501e1ac143e9a6bdea9fe6c8822b"
}
日付メンションタイプオブジェクト
日付メンションには、対応するフィールド内に日付プロパティ値オブジェクトが含まれます。date

メンションのリッチテキストオブジェクトの例mentiondate

JSONの

{
  "type": "mention",
  "mention": {
    "type": "date",
    "date": {
      "start": "2022-12-16",
      "end": null
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "2022-12-16",
  "href": null
}
リンクプレビューメンションタイプオブジェクト
ユーザーがリンクプレビューをメンションとして共有することを選択した場合、API はリンクプレビューのメンションを値 のリッチテキストオブジェクトとして扱います。リンクプレビューリッチテキストメンションには、リンクプレビューメンションの作成に使用されるオブジェクトを含む対応するオブジェクトが含まれています。typelink_previewlink_previewurl

メンションのリッチテキストオブジェクトの例mentionlink_preview

JSONの

{
  "type": "mention",
  "mention": {
    "type": "link_preview",
    "link_preview": {
      "url": "https://workspace.slack.com/archives/C04PF0F9QSD/z1671139297838409?thread_ts=1671139274.065079&cid=C03PF0F9QSD"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "https://workspace.slack.com/archives/C04PF0F9QSD/z1671139297838409?thread_ts=1671139274.065079&cid=C03PF0F9QSD",
  "href": "https://workspace.slack.com/archives/C04PF0F9QSD/z1671139297838409?thread_ts=1671139274.065079&cid=C03PF0F9QSD"
}
ページメンションタイプオブジェクト
ページメンションには、対応するフィールド内にページ参照が含まれます。ページ参照は、ページ ID に対応するプロパティと文字列値 (UUIDv4) を持つオブジェクトです。pageid

インテグレーションがメンションされたページにアクセスできない場合、メンションはIDのみで返されます。タイトルとなる値は と表示され、注釈オブジェクトの値はデフォルトです。plain_text"Untitled"

メンションのリッチテキストオブジェクトの例mentionpage

JSONの

{
  "type": "mention",
  "mention": {
    "type": "page",
    "page": {
      "id": "3c612f56-fdd0-4a30-a4d6-bda7d7426309"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "This is a test page",
  "href": "https://www.notion.so/3c612f56fdd04a30a4d6bda7d7426309"
}
テンプレートメンションタイプオブジェクト
NotionのUIのテンプレートボタン内のコンテンツには、プレースホルダーの日付や、テンプレートが複製されたときに入力されるユーザーメンションを含めることができます。テンプレートメンションタイプのオブジェクトには、これらの入力された値が含まれます。

テンプレート メンション リッチ テキスト オブジェクトには、 または .template_mentiontype"template_mention_date""template_mention_user"

キーが の場合、リッチテキストオブジェクトには次のフィールドが含まれます。type"template_mention_date"template_mention_date

畑	種類	形容	値の例
template_mention_date	string(列挙型)	日付メンションのタイプ。可能な値は、 と です。"today""now"	"today"
メンションのリッチテキストオブジェクトの例mentiontemplate_mention_date

JSONの

{
  "type": "mention",
  "mention": {
    "type": "template_mention",
    "template_mention": {
      "type": "template_mention_date",
      "template_mention_date": "today"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "@Today",
  "href": null
}
タイプキーが の場合、リッチテキストオブジェクトには次のフィールドが含まれます。"template_mention_user"template_mention_user

畑	種類	形容	値の例
template_mention_user	string(列挙型)	ユーザーメンションのタイプ。可能な値は のみです。"me"	"me"
メンションのリッチテキストオブジェクトの例mentiontemplate_mention_user

JSONの

{
  "type": "mention",
  "mention": {
    "type": "template_mention",
    "template_mention": {
      "type": "template_mention_user",
      "template_mention_user": "me"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "@Me",
  "href": null
}
ユーザーメンションタイプオブジェクト
リッチテキストオブジェクトの値が の場合、対応するユーザーフィールドにはユーザーオブジェクトが含まれます。type"user"

📘
インテグレーションがメンションされたユーザーに対してまだアクセスできない場合、ユーザーの名前は .統合を更新してユーザーがアクセスできるようにするには、統合設定ページで統合機能を更新します。plain_text"@Anonymous"

メンションのリッチテキストオブジェクトの例mentionuser

JSONの

{
  "type": "mention",
  "mention": {
    "type": "user",
    "user": {
      "object": "user",
      "id": "b2e19928-b427-4aad-9a9d-fde65479b1d9"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "@Anonymous",
  "href": null
}
テキスト
リッチテキストオブジェクトの値が の場合、対応するフィールドには、次のオブジェクトが含まれます。type"text"text

畑	種類	形容	値の例
content	string	テキストの実際のテキスト内容。	"Some words "
link	object(オプション)	このテキスト内の任意のインライン リンクに関する情報を含むオブジェクト (含まれている場合)。

テキストにインライン リンクが含まれている場合、オブジェクト キーは で、値は URL の文字列 Web アドレスです。

テキストにインライン リンクがない場合、値は です。urlnull	{ "url": "https://developers.notion.com/" }
リンクのないリッチテキストオブジェクトの例text
JSONの

{
  "type": "text",
  "text": {
    "content": "This is an ",
    "link": null
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "This is an ",
  "href": null
}
リンク付きのリッチテキストオブジェクトの例text
JSONの

{
  "type": "text",
  "text": {
    "content": "inline link",
    "link": {
      "url": "https://developers.notion.com/"
    }
  },
  "annotations": {
    "bold": false,
    "italic": false,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  },
  "plain_text": "inline link",
  "href": "https://developers.notion.com/"
}
      ====
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