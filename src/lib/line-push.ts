const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

export async function sendLinePush(lineUserIds: string[], message: string, url: string): Promise<void> {
  if (!CHANNEL_ACCESS_TOKEN || lineUserIds.length === 0) return

  const altText = message.split('\n')[0]

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
            altText,
            contents: {
              type: 'bubble',
              body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: message,
                    wrap: true,
                    size: 'md',
                  },
                ],
              },
              footer: {
                type: 'box',
                layout: 'vertical',
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
