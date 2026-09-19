export type SynnBotCommand = {
  name: string
  usage: string
  description: string
  category: string
  kind: "local" | "ai"
}

type AiTask = { name: string; description: string; instruction: string }
type AiMode = { suffix: string; label: string; instruction: string }

const LOCAL_COMMANDS: SynnBotCommand[] = [
  { name: "help", usage: "/help", description: "Explain how to browse all commands", category: "Bot", kind: "local" },
  { name: "commands", usage: "/commands", description: "Show command categories", category: "Bot", kind: "local" },
  { name: "gif", usage: "/gif", description: "Explain how to open the GIF picker", category: "Chat", kind: "local" },
  { name: "check", usage: "/check [filters] <url>", description: "Explain link safety checks", category: "Safety", kind: "local" },
  { name: "spoiler", usage: "/spoiler <text>", description: "Wrap text in spoilers", category: "Text", kind: "local" },
  { name: "shrug", usage: "/shrug [text]", description: "Add a shrug", category: "Text", kind: "local" },
  { name: "tableflip", usage: "/tableflip [text]", description: "Flip a table", category: "Text", kind: "local" },
  { name: "unflip", usage: "/unflip [text]", description: "Put the table back", category: "Text", kind: "local" },
  { name: "lenny", usage: "/lenny [text]", description: "Add a Lenny face", category: "Text", kind: "local" },
  { name: "flip", usage: "/flip", description: "Flip a coin", category: "Random", kind: "local" },
  { name: "roll", usage: "/roll [max]", description: "Roll one die", category: "Random", kind: "local" },
  { name: "dice", usage: "/dice [count] [sides]", description: "Roll several dice", category: "Random", kind: "local" },
  { name: "8ball", usage: "/8ball <question>", description: "Ask the magic 8-ball", category: "Random", kind: "local" },
  { name: "choose", usage: "/choose a | b | c", description: "Pick one option", category: "Random", kind: "local" },
  { name: "rps", usage: "/rps rock|paper|scissors", description: "Play rock paper scissors", category: "Games", kind: "local" },
  { name: "number", usage: "/number [max]", description: "Pick a random number", category: "Random", kind: "local" },
  { name: "joke", usage: "/joke", description: "Tell a joke", category: "Fun", kind: "local" },
  { name: "fact", usage: "/fact", description: "Share a fact", category: "Fun", kind: "local" },
  { name: "riddle", usage: "/riddle", description: "Ask a riddle", category: "Fun", kind: "local" },
  { name: "count", usage: "/count <text>", description: "Count characters and words", category: "Text", kind: "local" },
  { name: "reverse", usage: "/reverse <text>", description: "Reverse text", category: "Text", kind: "local" },
  { name: "uppercase", usage: "/uppercase <text>", description: "Make text uppercase", category: "Text", kind: "local" },
  { name: "lowercase", usage: "/lowercase <text>", description: "Make text lowercase", category: "Text", kind: "local" },
  { name: "mock", usage: "/mock <text>", description: "Alternate letter case", category: "Text", kind: "local" },
  { name: "calc", usage: "/calc 2 + 2", description: "Calculate basic arithmetic", category: "Tools", kind: "local" },
  { name: "hug", usage: "/hug [name]", description: "Send a hug", category: "Social", kind: "local" },
  { name: "wave", usage: "/wave [name]", description: "Wave to someone", category: "Social", kind: "local" },
  { name: "highfive", usage: "/highfive [name]", description: "Send a high five", category: "Social", kind: "local" },
  { name: "ping", usage: "/ping", description: "Check whether Synn Bot is awake", category: "Bot", kind: "local" },
  { name: "date", usage: "/date", description: "Show the UTC date", category: "Tools", kind: "local" },
]

const AI_TASKS: AiTask[] = [
  { name: "ask", description: "answer a question", instruction: "Answer the user's question accurately" },
  { name: "explain", description: "explain a topic", instruction: "Explain the requested topic" },
  { name: "summarize", description: "summarize supplied material", instruction: "Summarize the supplied material" },
  { name: "rewrite", description: "rewrite supplied text", instruction: "Rewrite the supplied text while preserving its meaning" },
  { name: "translate", description: "translate supplied text", instruction: "Translate the supplied text into the requested language" },
  { name: "brainstorm", description: "generate ideas", instruction: "Brainstorm useful ideas for the request" },
  { name: "outline", description: "create an outline", instruction: "Create a clear outline" },
  { name: "quiz", description: "create a quiz", instruction: "Create a quiz with an answer key" },
  { name: "flashcards", description: "create flashcards", instruction: "Create study flashcards" },
  { name: "studyplan", description: "build a study plan", instruction: "Build a realistic study plan" },
  { name: "proofread", description: "proofread writing", instruction: "Proofread the text and explain important corrections" },
  { name: "simplify", description: "make material easier", instruction: "Simplify the material without losing key facts" },
  { name: "expand", description: "expand an idea", instruction: "Expand the idea with useful detail" },
  { name: "shorten", description: "make text concise", instruction: "Shorten the text while keeping the important meaning" },
  { name: "titles", description: "suggest titles", instruction: "Suggest strong titles" },
  { name: "captions", description: "write captions", instruction: "Write suitable captions" },
  { name: "email", description: "draft an email", instruction: "Draft an effective email" },
  { name: "letter", description: "draft a letter", instruction: "Draft an effective letter" },
  { name: "essay", description: "help with an essay", instruction: "Help draft or improve an essay" },
  { name: "paragraph", description: "write a paragraph", instruction: "Write a focused paragraph" },
  { name: "thesis", description: "form a thesis", instruction: "Develop a defensible thesis statement" },
  { name: "arguments", description: "develop arguments", instruction: "Develop well-supported arguments" },
  { name: "counterarguments", description: "identify counterarguments", instruction: "Identify and fairly answer counterarguments" },
  { name: "compare", description: "compare subjects", instruction: "Compare the requested subjects using meaningful criteria" },
  { name: "proscons", description: "list pros and cons", instruction: "Provide a balanced pros and cons analysis" },
  { name: "examples", description: "give examples", instruction: "Give relevant concrete examples" },
  { name: "analogy", description: "create an analogy", instruction: "Create an accurate, memorable analogy" },
  { name: "definition", description: "define a term", instruction: "Define the requested term and clarify its use" },
  { name: "steps", description: "give ordered steps", instruction: "Provide actionable ordered steps" },
  { name: "checklist", description: "create a checklist", instruction: "Create a practical checklist" },
  { name: "timeline", description: "build a timeline", instruction: "Build a clear chronological timeline" },
  { name: "notes", description: "turn material into notes", instruction: "Turn the material into structured notes" },
  { name: "sources", description: "suggest source types", instruction: "Suggest reliable source types and search directions without fabricating citations" },
  { name: "keywords", description: "extract keywords", instruction: "Extract and organize useful keywords" },
  { name: "questions", description: "generate questions", instruction: "Generate useful questions about the topic" },
  { name: "answers", description: "draft answers", instruction: "Draft accurate answers to the supplied questions" },
  { name: "tutor", description: "tutor a topic", instruction: "Tutor the user interactively and check understanding" },
  { name: "practice", description: "create practice work", instruction: "Create useful practice exercises with answers" },
  { name: "mnemonic", description: "make a mnemonic", instruction: "Create a memorable mnemonic" },
  { name: "revise", description: "prepare revision material", instruction: "Create effective revision material" },
  { name: "grade", description: "evaluate work", instruction: "Evaluate the supplied work against stated criteria" },
  { name: "feedback", description: "give constructive feedback", instruction: "Give specific constructive feedback" },
  { name: "improve", description: "improve supplied work", instruction: "Improve the supplied work and explain the main changes" },
  { name: "debug", description: "debug a problem", instruction: "Diagnose the problem and propose a safe fix" },
  { name: "reviewcode", description: "review code", instruction: "Review the supplied code for correctness and maintainability" },
  { name: "refactor", description: "refactor code", instruction: "Refactor the code while preserving behavior" },
  { name: "optimize", description: "optimize an implementation", instruction: "Optimize the implementation and explain tradeoffs" },
  { name: "tests", description: "write tests", instruction: "Design useful tests for the supplied behavior" },
  { name: "regex", description: "build a regular expression", instruction: "Build and explain a safe regular expression" },
  { name: "sql", description: "help with SQL", instruction: "Write or debug SQL for the request" },
  { name: "html", description: "help with HTML", instruction: "Write or improve semantic HTML" },
  { name: "css", description: "help with CSS", instruction: "Write or debug CSS" },
  { name: "javascript", description: "help with JavaScript", instruction: "Write or debug JavaScript" },
  { name: "typescript", description: "help with TypeScript", instruction: "Write or debug type-safe TypeScript" },
  { name: "python", description: "help with Python", instruction: "Write or debug Python" },
  { name: "java", description: "help with Java", instruction: "Write or debug Java" },
  { name: "csharp", description: "help with C#", instruction: "Write or debug C#" },
  { name: "cpp", description: "help with C++", instruction: "Write or debug C++" },
  { name: "bash", description: "help with shell commands", instruction: "Write safe shell commands and explain them" },
  { name: "git", description: "help with Git", instruction: "Help with a safe Git workflow" },
  { name: "api", description: "design or use an API", instruction: "Help design, integrate, or debug an API" },
  { name: "json", description: "work with JSON", instruction: "Create, validate, or transform JSON" },
  { name: "markdown", description: "write Markdown", instruction: "Create clean Markdown" },
  { name: "accessibility", description: "improve accessibility", instruction: "Audit and improve accessibility" },
  { name: "security", description: "review security", instruction: "Provide defensive security guidance and identify risks" },
  { name: "privacy", description: "review privacy", instruction: "Identify privacy risks and safer choices" },
  { name: "performance", description: "improve performance", instruction: "Diagnose performance issues and suggest measurable improvements" },
  { name: "error", description: "explain an error", instruction: "Explain the supplied error and its likely fix" },
  { name: "algorithm", description: "design an algorithm", instruction: "Design and explain an appropriate algorithm" },
  { name: "pseudocode", description: "write pseudocode", instruction: "Write clear implementation-neutral pseudocode" },
  { name: "math", description: "solve mathematics", instruction: "Solve the mathematics carefully and show useful working" },
  { name: "physics", description: "help with physics", instruction: "Explain or solve the physics problem carefully" },
  { name: "chemistry", description: "help with chemistry", instruction: "Explain or solve the chemistry problem carefully" },
  { name: "biology", description: "help with biology", instruction: "Explain the biology topic accurately" },
  { name: "history", description: "help with history", instruction: "Explain the historical topic with context" },
  { name: "geography", description: "help with geography", instruction: "Explain the geography topic accurately" },
  { name: "literature", description: "analyze literature", instruction: "Analyze the supplied literature or question" },
  { name: "grammar", description: "help with grammar", instruction: "Explain and correct grammar" },
  { name: "vocabulary", description: "build vocabulary", instruction: "Teach useful vocabulary for the request" },
  { name: "language", description: "practice a language", instruction: "Help the user practice the requested language" },
  { name: "business", description: "help with business", instruction: "Give practical business analysis" },
  { name: "budget", description: "build a budget", instruction: "Build a clear budget from supplied figures" },
  { name: "schedule", description: "make a schedule", instruction: "Create a realistic schedule" },
  { name: "plan", description: "make an action plan", instruction: "Create an actionable plan" },
  { name: "prioritize", description: "prioritize tasks", instruction: "Prioritize the supplied tasks using clear criteria" },
  { name: "decide", description: "support a decision", instruction: "Help compare options and make a reasoned decision" },
  { name: "research", description: "plan research", instruction: "Create a responsible research plan and identify what to verify" },
  { name: "factcheck", description: "fact-check a claim", instruction: "Assess the claim, distinguish known facts from uncertainty, and state what needs verification" },
  { name: "interview", description: "prepare for an interview", instruction: "Prepare interview questions, answers, or practice" },
  { name: "resume", description: "improve a resume", instruction: "Improve resume content without inventing experience" },
  { name: "coverletter", description: "draft a cover letter", instruction: "Draft a tailored cover letter without inventing facts" },
  { name: "meeting", description: "prepare meeting material", instruction: "Prepare an agenda, notes, or follow-up for a meeting" },
  { name: "announcement", description: "draft an announcement", instruction: "Draft a clear announcement" },
  { name: "moderation", description: "help with moderation", instruction: "Suggest fair, safety-focused moderation wording or procedures" },
  { name: "rules", description: "draft rules", instruction: "Draft concise and enforceable community rules" },
  { name: "welcome", description: "write a welcome message", instruction: "Write a useful welcome message" },
  { name: "faq", description: "create an FAQ", instruction: "Create a clear FAQ from the supplied information" },
]

const AI_MODES: AiMode[] = [
  { suffix: "", label: "Standard", instruction: "Use the most appropriate clear format" },
  { suffix: "-simple", label: "Simple", instruction: "Use plain language suitable for a beginner" },
  { suffix: "-detailed", label: "Detailed", instruction: "Be thorough and include important nuance" },
  { suffix: "-quick", label: "Quick", instruction: "Give a concise answer focused on the result" },
  { suffix: "-academic", label: "Academic", instruction: "Use an academic tone and careful reasoning" },
  { suffix: "-creative", label: "Creative", instruction: "Use an original and engaging approach" },
  { suffix: "-professional", label: "Professional", instruction: "Use a polished professional tone" },
  { suffix: "-friendly", label: "Friendly", instruction: "Use a warm and approachable tone" },
  { suffix: "-steps", label: "Step by step", instruction: "Present the answer as actionable ordered steps" },
  { suffix: "-examples", label: "With examples", instruction: "Include concrete examples" },
]

const FEATURE_COMMANDS: SynnBotCommand[] = [
  { name: "customcmd", usage: "/customcmd <name> | <response>", description: "Create or update a staff custom command", category: "Bot", kind: "local" },
  { name: "delcmd", usage: "/delcmd <name>", description: "Delete a staff custom command", category: "Bot", kind: "local" },
  { name: "remind", usage: "/remind 30m <message>", description: "Create a persistent reminder", category: "Tools", kind: "local" },
  { name: "poll", usage: "/poll Question | Choice A | Choice B", description: "Create a channel poll", category: "Chat", kind: "local" },
  { name: "countdown", usage: "/countdown 1h <label>", description: "Create a persistent countdown", category: "Tools", kind: "local" },
  { name: "weather", usage: "/weather <place>", description: "Get current weather through Synn Bot", category: "Tools", kind: "local" },
  { name: "define", usage: "/define <word>", description: "Look up a dictionary definition", category: "Tools", kind: "local" },
  { name: "convert", usage: "/convert 5 km to mi", description: "Convert common units", category: "Tools", kind: "local" },
  { name: "currency", usage: "/currency 10 GBP to USD", description: "Convert currencies with a live rate", category: "Tools", kind: "local" },
  { name: "teams", usage: "/teams 2 | name1 | name2 | name3", description: "Randomly split names into teams", category: "Games", kind: "local" },
  { name: "bracket", usage: "/bracket name1 | name2 | name3", description: "Generate a tournament bracket", category: "Games", kind: "local" },
  { name: "findmsg", usage: "/findmsg <words>", description: "Search messages you are allowed to see", category: "Chat", kind: "local" },
  { name: "modsummary", usage: "/modsummary [user]", description: "Staff moderation summary", category: "Safety", kind: "local" },
  { name: "warn", usage: "/warn @user <reason>", description: "Warn a user with a required reason", category: "Safety", kind: "local" },
  { name: "mute", usage: "/mute @user <duration> <reason>", description: "Mute a user with a duration and reason", category: "Safety", kind: "local" },
  { name: "ban", usage: "/ban @user <reason>", description: "Device-ban a user with a required reason", category: "Safety", kind: "local" },
  { name: "unban", usage: "/unban @user <reason>", description: "Revoke a user's active permanent ban", category: "Safety", kind: "local" },
  { name: "staffcom", usage: "/staffcom <staff request>", description: "Ask Synn Bot to perform staff actions you are allowed to run", category: "Safety", kind: "local" },
  { name: "purge", usage: "/purge [count]", description: "Owner: purge messages from the current channel with an undo point", category: "Owner", kind: "local" },
  { name: "undo", usage: "/undo", description: "Owner: restore the latest reversible Synn Bot operation in this channel", category: "Owner", kind: "local" },
  { name: "provider", usage: "/provider", description: "Show Synn Bot’s live configured completion provider status", category: "Bot", kind: "local" },
  { name: "profile", usage: "/profile <username>", description: "Show a compact Synnical profile", category: "Social", kind: "local" },
  { name: "game", usage: "/game <title>", description: "Search the Synnical game catalog", category: "Games", kind: "local" },
  { name: "botstats", usage: "/botstats", description: "Show Synn Bot command analytics", category: "Bot", kind: "local" },
]

export const SYNN_BOT_ASYNC_COMMANDS = new Set(FEATURE_COMMANDS.map((command) => command.name))

const AI_COMMANDS: SynnBotCommand[] = AI_TASKS.map((task) => ({
  name: task.name,
  usage: `/${task.name} <request>`,
  description: task.description,
  category: task.name === "debug" || ["reviewcode", "refactor", "optimize", "tests", "regex", "sql", "html", "css", "javascript", "typescript", "python", "java", "csharp", "cpp", "bash", "git", "api", "json", "markdown"].includes(task.name) ? "Coding" : "Assistant",
  kind: "ai" as const,
}))

// Keep the palette real and searchable instead of manufacturing near-identical
// aliases. Owner administration runs through typed server capabilities.
export const SYNN_BOT_COMMANDS: SynnBotCommand[] = [...LOCAL_COMMANDS, ...FEATURE_COMMANDS, ...AI_COMMANDS]

if (new Set(SYNN_BOT_COMMANDS.map((command) => command.name)).size !== SYNN_BOT_COMMANDS.length) {
  throw new Error("Synn Bot command names must be unique")
}

const commandMap = new Map(SYNN_BOT_COMMANDS.map((command) => [command.name, command]))
const modeMap = new Map(AI_MODES.map((mode) => [mode.suffix, mode]))
const faces: Record<string, string> = { shrug: "¯\\_(ツ)_/¯", tableflip: "(╯°□°）╯︵ ┻━┻", unflip: "┬─┬ ノ( ゜-゜ノ)", lenny: "( ͡° ͜ʖ ͡°)" }
const answers = [
  "It is certain.", "It is decidedly so.", "Without a doubt.", "Yes — definitely.", "You may rely on it.",
  "As I see it, yes.", "Most likely.", "Outlook good.", "Yes.", "Signs point to yes.",
  "Reply hazy — ask again.", "Ask again later.", "Better not tell you now.", "Cannot predict now.", "Concentrate and ask again.",
  "Don't count on it.", "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful.",
]
const jokes = [
  "Why did the developer go broke? They used up all their cache.",
  "I told my computer I needed a break. It said: no problem, I’ll go to sleep.",
  "There are 10 kinds of people: those who understand binary and those who don’t.",
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "A SQL query walks into a bar, sees two tables, and asks: can I join you?",
  "Why was the JavaScript developer sad? They did not know how to null their feelings.",
  "My code worked on the first try. Naturally, I immediately became suspicious.",
  "Why did the function return early? It had somewhere else to be.",
  "The server asked for a timeout. The client took it personally.",
  "I renamed a bug to an undocumented feature. Management was thrilled.",
  "Why did the keyboard break up with the mouse? Too many clicks, not enough space.",
  "The database went to therapy because it had too many unresolved relations.",
  "Why was the array calm? It knew everything would eventually sort itself out.",
  "A frontend developer walks into a bar. The bar shifts three pixels to the left.",
  "Why did the commit cross the repository? To get to the other branch.",
  "I tried to tell a UDP joke, but I do not know if you got it.",
  "The CSS file said it needed space, so I gave it margin.",
  "Why did the cloud server carry an umbrella? Too many unexpected showers of requests.",
  "The bug report said 'sometimes'. Every engineer in the room aged five years.",
  "I asked Git for commitment. It told me to stage things first.",
]
const facts = [
  "Octopuses have three hearts.",
  "A day on Venus is longer than its year.",
  "Honey can remain edible for extremely long periods when stored properly.",
  "Bananas are berries botanically, while strawberries are not.",
  "Sharks existed before trees.",
  "The Eiffel Tower can grow slightly taller in hot weather because metal expands.",
  "A group of flamingos is commonly called a flamboyance.",
  "The human body has more than 600 skeletal muscles.",
  "Light from the Sun takes a little over eight minutes to reach Earth.",
  "Some turtles can breathe through specialized tissues near their rear end while underwater.",
  "Wombat droppings are cube-shaped.",
  "The Pacific Ocean is larger than all of Earth's land area combined.",
  "Saturn's average density is lower than water's.",
  "An adult human skeleton normally has 206 bones.",
  "The Moon is moving away from Earth by a few centimetres per year.",
  "A teaspoon of neutron-star material would have an enormous mass under Earth-like gravity.",
  "The shortest war commonly recorded lasted less than an hour: the Anglo-Zanzibar War of 1896.",
  "Crows can recognize individual human faces.",
  "The first computer mouse prototype was made from wood.",
  "IPv6 addresses are 128 bits long.",
]
const riddles = [
  "What has keys but no locks? ||A piano.||",
  "What gets wetter as it dries? ||A towel.||",
  "What has hands but cannot clap? ||A clock.||",
  "What has a neck but no head? ||A bottle.||",
  "What has one eye but cannot see? ||A needle.||",
  "What has many teeth but cannot bite? ||A comb.||",
  "What can travel around the world while staying in one corner? ||A stamp.||",
  "What goes up but never comes down? ||Your age.||",
  "What has words but never speaks? ||A book.||",
  "What has a thumb and four fingers but is not alive? ||A glove.||",
  "What can fill a room but takes up no space? ||Light.||",
  "What has cities but no houses, forests but no trees, and water but no fish? ||A map.||",
  "The more you take, the more you leave behind. What am I? ||Footsteps.||",
  "What belongs to you but other people use it more than you do? ||Your name.||",
  "What comes once in a minute, twice in a moment, and never in a thousand years? ||The letter M.||",
  "What can you catch but not throw? ||A cold.||",
  "What has a head and a tail but no body? ||A coin.||",
  "What kind of room has no doors or windows? ||A mushroom.||",
  "What breaks when you say its name? ||Silence.||",
  "What can run but never walks, has a mouth but never talks? ||A river.||",
]
const ask8BallPrompts = [
  "Give the 8-ball a question first, then I can pretend fate has an API.",
  "Ask a full question after /8ball and I'll shake the extremely scientific imaginary sphere.",
  "The 8-ball needs a question. Even fake prophecy apparently requires input validation.",
]
const choosePrompts = [
  "Give me at least two choices separated with |, for example `/choose pizza | noodles`.",
  "I need options separated by | before I can make a questionable decision for you.",
  "Two or more choices, separated with |. I cannot choose between absolutely nothing and absolutely nothing.",
]

export const SYNN_BOT_RESPONSE_POOL_SIZES = Object.freeze({
  eightBall: answers.length,
  jokes: jokes.length,
  facts: facts.length,
  riddles: riddles.length,
  eightBallPrompts: ask8BallPrompts.length,
  choosePrompts: choosePrompts.length,
})

function random<T>(values: readonly T[]): T { return values[Math.floor(Math.random() * values.length)] }
function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback
}

export type SynnBotAiRequest = { command: string; instruction: string; mode: string; request: string }

export function synnBotAiRequest(input: string): SynnBotAiRequest | null {
  const trimmed = input.trim()
  const [raw, ...rest] = trimmed.split(/\s+/)
  const commandName = raw.startsWith("/") ? raw.slice(1).toLowerCase() : ""
  const command = commandMap.get(commandName)
  if (!command || command.kind !== "ai") return null
  const task = AI_TASKS.find((candidate) => commandName === candidate.name || commandName.startsWith(`${candidate.name}-`))
  if (!task) return null
  const suffix = commandName.slice(task.name.length)
  const mode = modeMap.get(suffix)
  const request = rest.join(" ").trim().slice(0, 4000)
  return { command: commandName, instruction: task.instruction, mode: mode?.instruction || "Use the most appropriate clear format", request }
}

function commandList(): string {
  return "Type `/` to search Synn Bot’s real commands. Owners can use normal language for built-in administration, for example: “make a Donator tag with a pink heart”, “disable Movies”, or “undo that”."
}

export function synnBotReply(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) return null
  const [raw, ...rest] = trimmed.split(/\s+/)
  const command = raw.slice(1).toLowerCase()
  const args = rest.join(" ").slice(0, 1000)
  if (SYNN_BOT_ASYNC_COMMANDS.has(command)) return null
  if (commandMap.get(command)?.kind === "ai") return null
  if (faces[command]) return `${args}${args ? " " : ""}${faces[command]}`
  if (command === "help" || command === "commands") return commandList()
  if (command === "gif") return "Use the GIF button beside the message box to search GIPHY without leaving chat."
  if (command === "check") return rest[0] === "filters" || !args ? "Available checks: URL syntax, HTTPS, local safety rules, and chat moderation." : "Links are checked by Synnical's configured safety rules when posted."
  if (command === "spoiler") return args ? `||${args}||` : "Add text after /spoiler."
  if (command === "flip") return Math.random() < 0.5 ? "Coin: Heads" : "Coin: Tails"
  if (command === "roll") { const max = bounded(rest[0], 6, 2, 1_000_000); return `Roll: ${1 + Math.floor(Math.random() * max)} (1–${max})` }
  if (command === "dice") {
    const count = bounded(rest[0], 2, 1, 20); const sides = bounded(rest[1], 6, 2, 1_000)
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides))
    return `Dice ${count}d${sides}: ${rolls.join(", ")} (total ${rolls.reduce((sum, value) => sum + value, 0)})`
  }
  if (command === "8ball") return args ? `8-ball: ${random(answers)}` : random(ask8BallPrompts)
  if (command === "choose") { const options = args.split("|").map((item) => item.trim()).filter(Boolean); return options.length >= 2 ? `I choose: **${random(options)}**` : random(choosePrompts) }
  if (command === "rps") {
    const choice = args.toLowerCase(); const valid = ["rock", "paper", "scissors"] as const
    if (!valid.includes(choice as typeof valid[number])) return "Choose rock, paper, or scissors."
    const bot = random(valid); const win = (choice === "rock" && bot === "scissors") || (choice === "paper" && bot === "rock") || (choice === "scissors" && bot === "paper")
    return `You chose ${choice}; I chose ${bot}. ${choice === bot ? "Draw!" : win ? "You win!" : "I win!"}`
  }
  if (command === "number") { const max = bounded(rest[0], 100, 1, 1_000_000); return `Number: ${Math.floor(Math.random() * (max + 1))} (0–${max})` }
  if (command === "joke") return random(jokes)
  if (command === "fact") return `Fact: ${random(facts)}`
  if (command === "riddle") return `Riddle: ${random(riddles)}`
  if (command === "count") return args ? `Words: ${args.trim().split(/\s+/).length} · Characters: ${args.length}` : "Add text after /count."
  if (command === "reverse") return args ? Array.from(args).reverse().join("") : "Add text after /reverse."
  if (command === "uppercase") return args ? args.toUpperCase() : "Add text after /uppercase."
  if (command === "lowercase") return args ? args.toLowerCase() : "Add text after /lowercase."
  if (command === "mock") return args ? Array.from(args).map((char, index) => index % 2 ? char.toUpperCase() : char.toLowerCase()).join("") : "Add text after /mock."
  if (command === "hug") return `Sends ${args || "everyone"} a hug!`
  if (command === "wave") return `Waves${args ? ` to ${args}` : ""}!`
  if (command === "highfive") return `High-fives ${args || "everyone"}!`
  if (command === "ping") return "Pong! Synn Bot is online."
  if (command === "date") return `Date: ${new Date().toISOString().slice(0, 10)} UTC`
  if (command === "calc") {
    const match = args.match(/^(-?\d+(?:\.\d+)?)\s*([+\-*/%^])\s*(-?\d+(?:\.\d+)?)$/)
    if (!match) return "Use /calc number + number (also supports -, *, /, %, ^)."
    const left = Number(match[1]); const right = Number(match[3]); const op = match[2]
    if ((op === "/" || op === "%") && right === 0) return "Division by zero is not allowed."
    const result = op === "+" ? left + right : op === "-" ? left - right : op === "*" ? left * right : op === "/" ? left / right : op === "%" ? left % right : left ** right
    return Number.isFinite(result) ? `Calculation: ${left} ${op} ${right} = ${result}` : "That result is too large."
  }
  return `Unknown command /${command}. Type / to search the available Synn Bot commands.`
}
