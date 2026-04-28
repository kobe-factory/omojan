const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

export interface LinePushPayload {
  headerTitle: string   // 例: "🎯 新大会開始"
  headerColor: string   // 例: "#0284c7"
  headerSub?: string    // 例: "第2回大会 第3回戦"（省略可）
  body: string          // 本文テキスト
  url: string           // ボタンリンク
}

export async function sendLinePush(
  lineUserIds: string[],
  payload: LinePushPayload
): Promise<void> {
  if (!CHANNEL_ACCESS_TOKEN || lineUserIds.length === 0) return

  const { headerTitle, headerColor, headerSub, body, url } = payload

  const headerContents: object[] = [
    {
      type: 'text',
      text: headerTitle,
      color: '#FFFFFF',
      weight: 'bold',
      size: 'xl',
    },
  ]

  if (headerSub) {
    headerContents.push({
      type: 'text',
      text: headerSub,
      color: '#FFFFFFCC',
      size: 'xs',
      margin: 'sm',
    })
  }

  try {
    await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserIds,
        messages: [
          {
            type: 'flex',
            altText: headerTitle,
            contents: {
              type: 'bubble',
              header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: headerColor,
                paddingAll: '16px',
                contents: headerContents,
              },
              body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '16px',
                contents: [
                  {
                    type: 'text',
                    text: body,
                    wrap: true,
                    size: 'md',
                    color: '#333333',
                  },
                ],
              },
              footer: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '12px',
                contents: [
                  {
                    type: 'button',
                    action: {
                      type: 'uri',
                      label: 'おもじゃんを開く',
                      uri: url,
                    },
                    style: 'primary',
                    color: '#4CAF50',
                  },
                ],
              },
            },
          },
        ],
      }),
    })
  } catch (err) {
    console.error('[line-push] failed:', err)
  }
}
