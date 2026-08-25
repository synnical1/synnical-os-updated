export type ChatEmojiCategory = {
  id: string
  label: string
  keywords: string
  emojis: string[]
}

type EmojiRange = readonly [number, number]

function emojiRange(ranges: readonly EmojiRange[], limit: number, used: Set<string>): string[] {
  const values: string[] = []
  for (const [start, end] of ranges) {
    for (let codePoint = start; codePoint <= end && values.length < limit; codePoint += 1) {
      const emoji = String.fromCodePoint(codePoint)
      if (!/\p{Emoji_Presentation}/u.test(emoji) || used.has(emoji)) continue
      used.add(emoji)
      values.push(emoji)
    }
  }
  if (values.length !== limit) throw new Error(`Emoji catalog category expected ${limit}, received ${values.length}`)
  return values
}

const used = new Set<string>()

// Exactly 500 unique Unicode emoji. Categories keep the picker responsive:
// only the selected group is mounted instead of rebuilding all 500 buttons.
export const CHAT_EMOJI_CATEGORIES: ChatEmojiCategory[] = [
  {
    id: "faces",
    label: "Faces",
    keywords: "face smile happy laugh sad angry love emotion",
    emojis: emojiRange([[0x1f600, 0x1f64f], [0x1f910, 0x1f92f]], 100, used),
  },
  {
    id: "people",
    label: "People",
    keywords: "person people hand body gesture human",
    emojis: emojiRange([[0x1f440, 0x1f487], [0x1f9b0, 0x1f9df], [0x1f9f0, 0x1f9ff]], 70, used),
  },
  {
    id: "nature",
    label: "Nature",
    keywords: "animal plant weather flower pet nature",
    emojis: emojiRange([[0x1f300, 0x1f32c], [0x1f400, 0x1f43f]], 70, used),
  },
  {
    id: "food",
    label: "Food",
    keywords: "food drink fruit meal snack restaurant",
    emojis: emojiRange([[0x1f32d, 0x1f37f], [0x1f950, 0x1f96f]], 60, used),
  },
  {
    id: "activities",
    label: "Activities",
    keywords: "sport game party award activity celebration",
    emojis: emojiRange([[0x1f380, 0x1f3ff], [0x1f93a, 0x1f945]], 55, used),
  },
  {
    id: "travel",
    label: "Travel",
    keywords: "travel car train plane place transport map",
    emojis: emojiRange([[0x1f680, 0x1f6ff]], 55, used),
  },
  {
    id: "objects",
    label: "Objects",
    keywords: "object tool tech office music phone computer",
    emojis: emojiRange([[0x1f488, 0x1f5ff]], 60, used),
  },
  {
    id: "symbols",
    label: "Symbols",
    keywords: "symbol sign button arrow shape mark",
    emojis: emojiRange([[0x1f000, 0x1f2ff], [0x1f500, 0x1f53d]], 30, used),
  },
]

export const CHAT_REACTION_EMOJIS = CHAT_EMOJI_CATEGORIES.flatMap((category) => category.emojis)
export const CHAT_REACTION_EMOJI_SET = new Set(CHAT_REACTION_EMOJIS)

if (CHAT_REACTION_EMOJIS.length !== 500 || CHAT_REACTION_EMOJI_SET.size !== 500) {
  throw new Error("Chat reaction catalog must contain exactly 500 unique emoji")
}
