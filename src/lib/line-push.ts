const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN

export async function sendLinePush(lineUserIds: string[], message: string): Promise<void> {
  if (!CHANNEL_ACCESS_TOKEN || lineUserIds.length === 0) return

  try {
    await fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: lineUserIds,
        messages: [{ type: 'text', text: message }],
      }),
    })
  } catch (err) {
    console.error('[line-push] failed:', err)
  }
}
