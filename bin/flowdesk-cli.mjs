#!/usr/bin/env node
/**
 * FlowDesk CLI (Command-Line Interface).
 *
 * Direct terminal control for FlowDesk automation bridges (Reddit, WhatsApp, LinkedIn).
 * Connects to the running FlowDesk Local Gateway.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findGatewayConfig() {
  const candidatePaths = [
    process.env.FLOWDESK_GATEWAY_CONFIG,
    join(homedir(), '.flowdesk', 'gateway.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'FlowDesk', 'gateway.json') : null,
    process.env.HOME ? join(process.env.HOME, '.config', 'FlowDesk', 'gateway.json') : null,
  ].filter(Boolean)

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf8')
        return JSON.parse(content)
      } catch {}
    }
  }
  return null
}

async function callRpc(method, params = {}, timeoutOverrideMs) {
  const cfg = findGatewayConfig()
  if (!cfg || !cfg.port || !cfg.token) {
    console.error('\x1b[31m[FlowDesk Error]\x1b[0m FlowDesk is not running or Local Gateway is unavailable.')
    console.error('Please open FlowDesk desktop app first to run CLI commands.')
    process.exit(1)
  }

  const url = `http://127.0.0.1:${cfg.port}/rpc`
  const timeoutMs = timeoutOverrideMs ?? ((params && (params.durationSeconds || params.seconds))
    ? (Number(params.durationSeconds || params.seconds) + 120) * 1000
    : 180000)

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    console.error(`\x1b[31m[FlowDesk Connection Error]\x1b[0m Failed to reach Gateway at ${url}:`, err.message || err)
    process.exit(1)
  }

  if (!res.ok) {
    const text = await res.text()
    console.error(`\x1b[31m[Gateway Error ${res.status}]\x1b[0m ${text}`)
    process.exit(1)
  }

  const json = await res.json()
  if (!json.ok) {
    console.error(`\x1b[31m[RPC Error]\x1b[0m ${json.error || 'Failed'}`)
    process.exit(1)
  }
  return json.result
}

function renderProgressBar(percent, stage, elapsedSeconds) {
  const barWidth = 28
  const clampedPercent = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clampedPercent / 100) * barWidth)
  const empty = barWidth - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const timeStr = elapsedSeconds !== '' && elapsedSeconds !== undefined ? `(${elapsedSeconds}s) ` : ''
  const line = `\r\x1b[36m[${bar}] ${clampedPercent}%\x1b[0m ${timeStr}\x1b[33m${stage}\x1b[0m\x1b[K`
  process.stdout.write(line)
}

function listenToGatewayEvents(onEvent) {
  const cfg = findGatewayConfig()
  if (!cfg || !cfg.port || !cfg.token) return () => {}

  const url = `http://127.0.0.1:${cfg.port}/events`
  const controller = new AbortController()
  fetch(url, {
    headers: { 'Authorization': `Bearer ${cfg.token}` },
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) return
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onEvent(data)
          } catch {}
        }
      }
    }
  }).catch(() => {})

  return () => controller.abort()
}

async function confirmAction(promptMessage, autoApprove = false) {
  if (autoApprove) return true
  const rl = createInterface({ input, output })
  const answer = await rl.question(`\x1b[33m? ${promptMessage} [y/N]: \x1b[0m`)
  rl.close()
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
}

function parseFlags(args) {
  const flags = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1]
        i++
      } else {
        flags[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { flags, positional }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printHelp()
    return
  }

  const command = rawArgs[0]

  if (command === 'mcp') {
    const mcpPath = join(__dirname, 'flowdesk-mcp.mjs')
    const child = spawn(process.execPath, [mcpPath], { stdio: 'inherit' })
    child.on('exit', code => process.exit(code ?? 0))
    return
  }

  if (command === 'status') {
    const cfg = findGatewayConfig()
    if (!cfg) {
      console.log('\x1b[31mFlowDesk is NOT running.\x1b[0m (Start FlowDesk desktop app first)')
      return
    }
    console.log(`\x1b[32mFlowDesk Gateway is RUNNING\x1b[0m (Port: ${cfg.port}, PID: ${cfg.pid})`)
    const res = await fetch(`http://127.0.0.1:${cfg.port}/status`, {
      headers: { 'Authorization': `Bearer ${cfg.token}` }
    })
    const data = await res.json()
    console.log('\nService Status:')
    console.log(`  Reddit:   ${data.providers?.reddit?.signedIn ? '\x1b[32mConnected (@' + data.providers.reddit.username + ')\x1b[0m' : '\x1b[33mNot signed in\x1b[0m'}`)
    console.log(`  WhatsApp: ${(data.providers?.whatsapp?.ready || data.providers?.whatsapp?.signedIn) ? '\x1b[32mConnected\x1b[0m' : '\x1b[33mNot connected\x1b[0m'}`)
    console.log(`  LinkedIn: ${data.providers?.linkedin?.signedIn ? '\x1b[32mConnected\x1b[0m' : '\x1b[33mNot signed in\x1b[0m'}`)
    return
  }

  // ── REDDIT COMMANDS ────────────────────────────────────────────────────────
  if (command === 'reddit') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'status') {
      const res = await callRpc('reddit.status')
      console.log('\x1b[36m=== Reddit Identity ===\x1b[0m')
      console.log(`Username:    ${res.username || 'Not signed in'}`)
      console.log(`Total Karma: ${res.totalKarma ?? 'N/A'}`)
      console.log(`Inbox Mail:  ${res.hasMail ? res.inboxCount + ' unread' : 'No new messages'}`)
      return
    }

    if (subCmd === 'feed') {
      const sub = flags.sub || flags.subreddit
      const sort = flags.sort || 'hot'
      const limit = Number(flags.limit || 10)
      console.log(`\x1b[36mFetching Reddit ${sub ? 'r/' + sub : 'Home'} (${sort}, limit ${limit})...\x1b[0m\n`)
      const res = await callRpc('reddit.feed', { subreddit: sub, sort, limit })
      if (!res.posts || res.posts.length === 0) {
        console.log('No posts found.')
        return
      }
      res.posts.forEach((p, idx) => {
        console.log(`\x1b[33m[${idx + 1}] ${p.title}\x1b[0m`)
        console.log(`    Subreddit: ${p.subreddit} | Author: u/${p.author} | Score: ▲ ${p.score} | Comments: ${p.numComments}`)
        console.log(`    Link: https://reddit.com${p.permalink}\n`)
      })
      return
    }

    if (subCmd === 'comments') {
      const sub = flags.sub || flags.subreddit || positional[0]
      const postId = flags.post || positional[1]
      if (!sub || !postId) {
        console.error('Usage: flowdesk reddit comments --sub <subreddit> --post <postId>')
        return
      }
      const res = await callRpc('reddit.postComments', { subreddit: sub, postId, limit: Number(flags.limit || 10) })
      console.log(`\x1b[36m=== Post: ${res.post?.title} ===\x1b[0m\n`)
      if (res.comments) {
        res.comments.forEach(c => {
          console.log(`\x1b[32mu/${c.author}\x1b[0m (▲ ${c.score}): ${c.body.slice(0, 150)}...`)
        })
      }
      return
    }

    if (subCmd === 'search') {
      const query = positional.join(' ') || flags.query
      if (!query) {
        console.error('Usage: flowdesk reddit search <query>')
        return
      }
      const res = await callRpc('reddit.search', { query, limit: Number(flags.limit || 10) })
      console.log(`\x1b[36mSearch results for "${query}":\x1b[0m\n`)
      res.results?.forEach((p, idx) => {
        console.log(`[${idx + 1}] ${p.title} (${p.subreddit}) -> https://reddit.com${p.permalink}`)
      })
      return
    }

    if (subCmd === 'post') {
      const sub = flags.sub || flags.subreddit
      const title = flags.title
      const body = flags.body
      if (!sub || !title) {
        console.error('Usage: flowdesk reddit post --sub <subreddit> --title "<title>" [--body "<body>"] [--yes]')
        return
      }

      console.log(`\n\x1b[36mAbout to publish Reddit post:\x1b[0m`)
      console.log(`  Subreddit: r/${sub}`)
      console.log(`  Title:     ${title}`)
      if (body) console.log(`  Body:      ${body.slice(0, 100)}...`)

      const confirmed = await confirmAction('Publish this post to Reddit now?', Boolean(flags.yes))
      if (!confirmed) {
        console.log('\x1b[31mCancelled.\x1b[0m Post was not published.')
        return
      }

      console.log('Publishing...')
      const res = await callRpc('reddit.createPost', { subreddit: sub, title, body })
      console.log('\x1b[32mPost created successfully!\x1b[0m', res)
      return
    }

    if (subCmd === 'comment') {
      const postId = flags.post
      const parentId = flags.parent || postId
      const text = flags.text
      if (!postId || !text) {
        console.error('Usage: flowdesk reddit comment --post <postId> --text "<text>" [--parent <parentId>] [--yes]')
        return
      }

      const confirmed = await confirmAction(`Post comment: "${text}"?`, Boolean(flags.yes))
      if (!confirmed) {
        console.log('\x1b[31mCancelled.\x1b[0m')
        return
      }

      const res = await callRpc('reddit.createComment', { postId, parentId, text })
      console.log('\x1b[32mComment submitted successfully!\x1b[0m', res)
      return
    }

    if (subCmd === 'vote') {
      const postId = flags.post
      const action = (flags.action || 'UP').toUpperCase()
      if (!postId) {
        console.error('Usage: flowdesk reddit vote --post <postId> --action <UP|DOWN|NONE>')
        return
      }
      await callRpc('reddit.votePost', { postId, voteState: action })
      console.log(`\x1b[32mVote updated to ${action} for post ${postId}!\x1b[0m`)
      return
    }

    if (subCmd === 'outlier') {
      const sub = positional[0] || flags.subreddit || flags.sub
      if (!sub) {
        console.error('Usage: flowdesk reddit outlier <subreddit> [--min-multiplier <m>]')
        return
      }
      const minMultiplier = Number(flags['min-multiplier'] || flags.multiplier || flags.m || 3.0)
      console.log(`\x1b[36mRunning Reddit Viral Outlier Miner on r/${sub} (min ${minMultiplier}x multiplier)...\x1b[0m\n`)
      const res = await callRpc('reddit.outlier', { subreddit: sub, minMultiplier })
      console.log(`\x1b[32m=== r/${res.subreddit} Outlier Report ===\x1b[0m`)
      console.log(`Sample Analyzed: ${res.sampleSize} posts`)
      console.log(`Median Upvotes:  ${res.medianScore} | Median Comments: ${res.medianComments}`)
      console.log(`Outliers Found:  ${res.outlierCount}\n`)

      if (res.outliers && res.outliers.length > 0) {
        console.log('\x1b[35m🚀 VIRAL BREAKOUT OUTLIERS:\x1b[0m')
        res.outliers.forEach((p, idx) => {
          console.log(`  [${idx + 1}] \x1b[1m${p.title}\x1b[0m`)
          console.log(`      Score: ▲ ${p.score} (\x1b[32m${p.outlierMultiplier}x median\x1b[0m) | Comments: ${p.numComments} | u/${p.author}`)
          console.log(`      Link: https://reddit.com${p.permalink}`)
        })
        console.log('')
      } else {
        console.log('No posts exceeded the outlier multiplier threshold.\n')
      }

      if (res.highDebatePainPoints && res.highDebatePainPoints.length > 0) {
        console.log('\x1b[33m🔥 HIGH-DEBATE & FRUSTRATION PAIN POINTS:\x1b[0m')
        res.highDebatePainPoints.slice(0, 5).forEach((p, idx) => {
          console.log(`  [${idx + 1}] ${p.title}`)
          console.log(`      Comments: ${p.numComments} | Score: ▲ ${p.score} | Ratio: ${p.debateRatio || (p.numComments / Math.max(1, p.score)).toFixed(2)}x`)
        })
        console.log('')
      }

      if (res.topHooks && res.topHooks.length > 0) {
        console.log('\x1b[36m🎣 EXTRACTED VIRAL HOOK PATTERNS:\x1b[0m')
        res.topHooks.slice(0, 5).forEach((h, idx) => {
          console.log(`  [${idx + 1}] \x1b[33m[${h.pattern}]\x1b[0m ${h.title}`)
          console.log(`      Template: "${h.hookTemplate}"`)
        })
        console.log('')
      }
      return
    }

    if (subCmd === 'api-feed') {
      const sub = flags.subreddit || flags.sub
      const sort = flags.sort || 'hot'
      const limit = Number(flags.limit || 25)
      console.log(`\x1b[36mFetching fast in-session Reddit feed ${sub ? 'r/' + sub : 'Home'} (${sort}, limit ${limit})...\x1b[0m\n`)
      const res = await callRpc('reddit.api_feed', { subreddit: sub, sort, limit })
      const posts = res.items || res.posts || []
      if (posts.length === 0) {
        console.log('No posts found.')
        return
      }
      posts.forEach((p, idx) => {
        console.log(`\x1b[33m[${idx + 1}] ${p.title}\x1b[0m`)
        console.log(`    ${p.subreddit} | Author: u/${p.author} | Score: ▲ ${p.score} | Comments: ${p.numComments}`)
        console.log(`    Link: https://reddit.com${p.permalink}\n`)
      })
      return
    }

    if (subCmd === 'api-search') {
      const query = positional.join(' ') || flags.query || flags.q
      if (!query) {
        console.error('Usage: flowdesk reddit api-search <query> [--subreddit <s>] [--limit <n>]')
        return
      }
      const sub = flags.subreddit || flags.sub
      const limit = Number(flags.limit || 25)
      console.log(`\x1b[36mFast searching Reddit for "${query}"${sub ? ' in r/' + sub : ''} (limit ${limit})...\x1b[0m\n`)
      const res = await callRpc('reddit.api_search', { query, subreddit: sub, limit })
      const results = res.items || res.results || []
      if (results.length === 0) {
        console.log('No results found.')
        return
      }
      results.forEach((p, idx) => {
        console.log(`[${idx + 1}] ${p.title} (${p.subreddit}) | ▲ ${p.score} | Comments: ${p.numComments}`)
        console.log(`    Link: https://reddit.com${p.permalink}`)
      })
      return
    }

    if (subCmd === 'api-comments') {
      const postId = positional[0] || flags.postId || flags.post || flags.id
      if (!postId) {
        console.error('Usage: flowdesk reddit api-comments <postId> [--limit <n>]')
        return
      }
      const limit = Number(flags.limit || 20)
      console.log(`\x1b[36mFetching fast flattened comments for post ${postId} (limit ${limit})...\x1b[0m\n`)
      const res = await callRpc('reddit.api_post_comments', { postId, limit })
      if (res.post) {
        console.log(`\x1b[36m=== Post: ${res.post.title || postId} ===\x1b[0m`)
        console.log(`Author: u/${res.post.author || 'unknown'} | Score: ▲ ${res.post.score} | Comments: ${res.post.numComments}\n`)
      }
      if (res.comments && res.comments.length > 0) {
        res.comments.forEach((c, idx) => {
          console.log(`[${idx + 1}] \x1b[32mu/${c.author}\x1b[0m (▲ ${c.score}): ${c.body.slice(0, 200).replace(/\n/g, ' ')}...`)
        })
      } else {
        console.log('No comments found.')
      }
      return
    }
  }

  // ── WHATSAPP COMMANDS ──────────────────────────────────────────────────────
  if (command === 'whatsapp') {
    const subCmd = rawArgs[1]
    const { flags } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'chats') {
      const res = await callRpc('whatsapp.listChats', { limit: Number(flags.limit || 10) })
      console.log('\x1b[36m=== WhatsApp Recent Chats ===\x1b[0m\n')
      res.chats?.forEach((c, idx) => {
        console.log(`[${idx + 1}] ${c.name || c.id} ${c.unreadCount > 0 ? '\x1b[31m(' + c.unreadCount + ' unread)\x1b[0m' : ''}`)
      })
      return
    }

    if (subCmd === 'send') {
      const to = flags.to
      const message = flags.msg || flags.message
      if (!to || !message) {
        console.error('Usage: flowdesk whatsapp send --to <chatId> --message "<text>" [--yes]')
        return
      }
      const confirmed = await confirmAction(`Send WhatsApp message to ${to}?`, Boolean(flags.yes))
      if (!confirmed) {
        console.log('Cancelled.')
        return
      }
      await callRpc('whatsapp.send', { chatId: to, text: message })
      console.log('\x1b[32mWhatsApp message sent!\x1b[0m')
      return
    }

    if (subCmd === 'api-chats') {
      const limit = Number(flags.limit || 20)
      const unread = Boolean(flags.unread || flags['only-unread'] || flags.onlyUnread)
      const res = await callRpc('whatsapp.api_chats', { limit, onlyUnread: unread })
      console.log(`\x1b[36m=== WhatsApp In-Session Chats (limit ${limit}${unread ? ', unread only' : ''}) ===\x1b[0m\n`)
      const chats = res.chats || []
      if (chats.length === 0) {
        console.log('No chats found.')
        return
      }
      chats.forEach((c, idx) => {
        const unreadTag = c.unreadCount > 0 ? ` \x1b[31m(${c.unreadCount} unread)\x1b[0m` : ''
        console.log(`[${idx + 1}] \x1b[33m${c.name || c.id}\x1b[0m${unreadTag} - ID: ${c.id}`)
      })
      return
    }

    if (subCmd === 'api-messages') {
      const chatId = positional[0] || flags.chatId || flags.chat || flags.to
      if (!chatId) {
        console.error('Usage: flowdesk whatsapp api-messages <chatId> [--limit <n>]')
        return
      }
      const limit = Number(flags.limit || 20)
      const res = await callRpc('whatsapp.api_messages', { chatId, limit })
      console.log(`\x1b[36m=== WhatsApp Messages for ${chatId} ===\x1b[0m\n`)
      const messages = res.messages || []
      if (messages.length === 0) {
        console.log('No messages found.')
        return
      }
      messages.forEach((m, idx) => {
        const sender = m.fromMe ? '\x1b[34m[Me]\x1b[0m' : `\x1b[32m[${m.sender || 'Them'}]\x1b[0m`
        console.log(`[${idx + 1}] ${sender} ${m.body || m.text || ''}`)
      })
      return
    }
  }

  // ── LINKEDIN COMMANDS ──────────────────────────────────────────────────────
  if (command === 'linkedin') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))
    const account = flags.account || flags.a

    if (subCmd === 'accounts' || subCmd === 'list') {
      const res = await callRpc('linkedin.accounts')
      console.log('\x1b[36m=== LinkedIn Connected Accounts ===\x1b[0m\n')
      res.accounts?.forEach(acc => {
        const activeMarker = acc.active ? ' \x1b[32m[ACTIVE IN WINDOW]\x1b[0m' : ''
        const authStatus = acc.authenticated ? `\x1b[32mAuthenticated (${acc.name || acc.publicId || 'User'})\x1b[0m` : '\x1b[33mNot logged in (Fresh partition)\x1b[0m'
        console.log(`\x1b[33m• ${acc.label}\x1b[0m (ID: ${acc.id}, Partition: \`${acc.partition}\`)${activeMarker}`)
        console.log(`    Status: ${authStatus}`)
        if (acc.headline) console.log(`    Title:  ${acc.headline}`)
        if (acc.currentUrl) console.log(`    URL:    ${acc.currentUrl}`)
      })
      return
    }

    if (subCmd === 'switch') {
      const target = positional[0] || flags.account || flags.a || '1'
      const res = await callRpc('linkedin.switchAccount', { account: target })
      console.log(`\x1b[32mSwitched active LinkedIn account to ${target} (${res.account})\x1b[0m`)
      return
    }

    if (subCmd === 'status') {
      const res = await callRpc('linkedin.status', { account })
      console.log(`\x1b[36m=== LinkedIn Status (${res.account || 'Account 1'})\x1b[0m\n`)
      console.log(`Authenticated: ${res.signedIn ? '\x1b[32mYES\x1b[0m' : '\x1b[33mNO\x1b[0m'}`)
      if (res.name) console.log(`Name:        ${res.name}`)
      if (res.headline) console.log(`Headline:    ${res.headline}`)
      if (res.publicId) console.log(`Public ID:   ${res.publicId}`)
      return
    }

    if (subCmd === 'feed') {
      const res = await callRpc('linkedin.feed', { limit: Number(flags.limit || 10), account })
      console.log(`\x1b[36m=== LinkedIn Feed (${account ? 'Account ' + account : 'Active Account'}) ===\x1b[0m\n`)
      const items = res.posts || res.updates || []
      if (items.length === 0) {
        console.log('No posts found.')
      } else {
        items.forEach((u, idx) => {
          console.log(`\x1b[33m[${idx + 1}] ${u.author || u.actorName || 'Unknown'}\x1b[0m: ${u.text?.slice(0, 120).replace(/\n/g, ' ')}...`)
        })
      }
      return
    }

    if (subCmd === 'outlier') {
      const minMultiplier = Number(flags['min-multiplier'] || flags.multiplier || flags.m || 3.0)
      const limit = flags.limit ? Number(flags.limit) : undefined
      console.log(`\x1b[36mRunning LinkedIn Outlier & Viral Hook Analyzer (${account ? 'Account ' + account : 'Active Account'}, min ${minMultiplier}x multiplier)...\x1b[0m\n`)
      const res = await callRpc('linkedin.outlier', { minMultiplier, limit, account })
      console.log(`\x1b[32m=== LinkedIn Viral Outlier Report ===\x1b[0m`)
      console.log(`Sample Analyzed: ${res.sampleSize || res.analyzedCount || 'N/A'} posts`)
      console.log(`Median Score:    ${res.medianScore ?? res.medianEngagements ?? 'N/A'}`)
      console.log(`Outliers Found:  ${res.outliers ? res.outliers.length : 0}\n`)

      if (res.outliers && res.outliers.length > 0) {
        console.log('\x1b[35m🚀 VIRAL LINKEDIN POSTS:\x1b[0m')
        res.outliers.forEach((p, idx) => {
          console.log(`  [${idx + 1}] \x1b[1m${p.author || 'Author'}\x1b[0m: ${p.text ? p.text.slice(0, 100).replace(/\n/g, ' ') : ''}...`)
          console.log(`      Multiplier: \x1b[32m${p.outlierMultiplier || p.multiplier || 'N/A'}x\x1b[0m | Reactions: ${p.score || p.numReactions || 'N/A'}`)
        })
        console.log('')
      }

      if (res.topHooks && res.topHooks.length > 0) {
        console.log('\x1b[36m🎣 VIRAL HOOK STRUCTURES:\x1b[0m')
        res.topHooks.slice(0, 5).forEach((h, idx) => {
          console.log(`  [${idx + 1}] \x1b[33m[${h.pattern || h.structure || 'Hook'}]\x1b[0m ${h.hook || h.title || ''}`)
        })
        console.log('')
      }
      return
    }

    if (subCmd === 'api-feed') {
      const limit = Number(flags.limit || 20)
      console.log(`\x1b[36mFetching fast Voyager LinkedIn feed (${account ? 'Account ' + account : 'Active Account'}, limit ${limit})...\x1b[0m\n`)
      const res = await callRpc('linkedin.api_feed', { limit, account })
      const posts = res.posts || res.items || res.updates || []
      if (posts.length === 0) {
        console.log('No posts found.')
        return
      }
      posts.forEach((p, idx) => {
        console.log(`\x1b[33m[${idx + 1}] ${p.author || p.actorName || 'Unknown'}\x1b[0m (▲ ${p.numReactions || p.score || 0}, ${p.numComments || 0} comments)`)
        console.log(`    ${(p.text || '').slice(0, 150).replace(/\n/g, ' ')}...`)
        if (p.url || p.permalink) console.log(`    Link: ${p.url || p.permalink}`)
        console.log('')
      })
      return
    }

    if (subCmd === 'search') {
      const query = positional.join(' ') || flags.query
      if (!query) {
        console.error('Usage: flowdesk linkedin search <query> [--limit <n>] [--account 1|2]')
        return
      }
      const limit = Number(flags.limit || 10)
      const resultType = (flags.type === 'posts' || flags.type === 'content') ? 'CONTENT' : (flags.type || undefined)
      console.log(`\x1b[36mSearching LinkedIn for "${query}" (${resultType || 'ALL'}, limit ${limit}, ${account ? 'Account ' + account : 'Active Account'})...\x1b[0m\n`)
      const res = await callRpc('linkedin.search', { query, limit, resultType, account })
      const clusters = res.clusters || []
      if (clusters.length === 0) {
        console.log('No results found.')
        return
      }
      clusters.forEach(c => {
        console.log(`\x1b[35m=== ${c.group} (${c.count} items) ===\x1b[0m`)
        c.items.forEach((item, idx) => {
          console.log(`[${idx + 1}] \x1b[1m${item.title}\x1b[0m${item.subtitle ? ' • \x1b[90m' + item.subtitle + '\x1b[0m' : ''}`)
          if (item.detail) console.log(`    \x1b[32m${item.detail}\x1b[0m`)
          if (item.summary) console.log(`    ${item.summary.slice(0, 160).replace(/\n/g, ' ')}...`)
          if (item.url) console.log(`    Link: ${item.url}`)
          console.log('')
        })
      })
      return
    }

    if (subCmd === 'profile' || subCmd === 'get-profile') {
      console.log(`\x1b[36mFetching LinkedIn authenticated profile (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m\n`)
      const res = await callRpc('linkedin.getProfile', { account })
      const profile = res.profile || res
      console.log('\x1b[32m=== LinkedIn Profile ===\x1b[0m')
      console.log(`Name:        \x1b[1m${profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'N/A'}\x1b[0m`)
      if (profile.headline) console.log(`Headline:    ${profile.headline}`)
      if (profile.location) console.log(`Location:    ${profile.location}`)
      if (profile.email) console.log(`Email:       ${profile.email}`)
      if (profile.publicIdentifier) console.log(`Public URL:  https://www.linkedin.com/in/${profile.publicIdentifier}`)
      if (profile.summary) {
        console.log('\n\x1b[33mAbout:\x1b[0m')
        console.log(profile.summary)
      }
      if (profile.experience && profile.experience.length > 0) {
        console.log('\n\x1b[35mExperience:\x1b[0m')
        profile.experience.forEach((exp, idx) => {
          console.log(`  [${idx + 1}] ${exp.title || 'Role'} at ${exp.companyName || 'Company'}${exp.timePeriod ? ' (' + exp.timePeriod + ')' : ''}`)
        })
      }
      if (profile.education && profile.education.length > 0) {
        console.log('\n\x1b[34mEducation:\x1b[0m')
        profile.education.forEach((edu, idx) => {
          console.log(`  [${idx + 1}] ${edu.schoolName || 'School'}${edu.degreeName ? ' - ' + edu.degreeName : ''}${edu.fieldOfStudy ? ' (' + edu.fieldOfStudy + ')' : ''}`)
        })
      }
      if (profile.profilePicture) console.log(`\nAvatar:      ${profile.profilePicture}`)
      if (profile.backgroundPicture) console.log(`Cover:       ${profile.backgroundPicture}`)
      return
    }

    if (subCmd === 'update-profile') {
      const firstName = flags.firstName || flags['first-name']
      const lastName = flags.lastName || flags['last-name']
      const headline = flags.headline
      const location = flags.location
      const summary = flags.about || flags.summary
      if (!firstName && !lastName && !headline && !location && !summary) {
        console.error('Usage: flowdesk linkedin update-profile [--headline "text"] [--first-name "name"] [--last-name "name"] [--location "loc"] [--about "text"] [--account 1|2]')
        return
      }
      console.log(`\x1b[36mUpdating LinkedIn profile (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('linkedin.updateProfile', { firstName, lastName, headline, location, summary, account })
      if (res && res.ok) {
        console.log('\x1b[32mProfile updated successfully!\x1b[0m', res.message || '')
      } else {
        console.error('\x1b[31mFailed to update profile:\x1b[0m', (res && res.error) || 'Unknown error')
      }
      return
    }

    if (subCmd === 'upload-photo') {
      const imagePath = positional[0] || flags.file || flags.path || flags.image
      if (!imagePath) {
        console.error('Usage: flowdesk linkedin upload-photo <imagePath> [--account 1|2]')
        return
      }
      console.log(`\x1b[36mUploading LinkedIn profile photo from ${imagePath} (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('linkedin.uploadProfilePhoto', { imagePath, account })
      if (res && res.ok) {
        console.log('\x1b[32mProfile photo updated successfully!\x1b[0m', res.message || '')
      } else {
        console.error('\x1b[31mFailed to upload profile photo:\x1b[0m', (res && res.error) || 'Unknown error')
      }
      return
    }

    if (subCmd === 'upload-cover') {
      const imagePath = positional[0] || flags.file || flags.path || flags.image
      if (!imagePath) {
        console.error('Usage: flowdesk linkedin upload-cover <imagePath> [--account 1|2]')
        return
      }
      console.log(`\x1b[36mUploading LinkedIn cover banner from ${imagePath} (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('linkedin.uploadCoverImage', { imagePath, account })
      if (res && res.ok) {
        console.log('\x1b[32mCover image updated successfully!\x1b[0m', res.message || '')
      } else {
        console.error('\x1b[31mFailed to upload cover banner:\x1b[0m', (res && res.error) || 'Unknown error')
      }
      return
    }
  }

  // ── TIKTOK COMMANDS ────────────────────────────────────────────────────────
  if (command === 'tiktok') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))
    const account = flags.account || flags.a

    if (subCmd === 'accounts' || subCmd === 'list') {
      const res = await callRpc('tiktok.accounts')
      console.log('\x1b[36m=== TikTok Connected Accounts ===\x1b[0m\n')
      res.accounts?.forEach(acc => {
        const activeMarker = acc.active ? ' \x1b[32m[ACTIVE IN WINDOW]\x1b[0m' : ''
        const authStatus = acc.authenticated ? `\x1b[32mAuthenticated (@${acc.username || 'user'})\x1b[0m` : '\x1b[33mNot logged in (Fresh partition)\x1b[0m'
        console.log(`\x1b[33m• ${acc.label}\x1b[0m (ID: ${acc.id}, Partition: \`${acc.partition}\`)${activeMarker}`)
        console.log(`    Status: ${authStatus}`)
        if (acc.currentUrl) console.log(`    URL:    ${acc.currentUrl}`)
      })
      return
    }

    if (subCmd === 'switch') {
      const target = positional[0] || flags.account || flags.a || '1'
      const res = await callRpc('tiktok.switchAccount', { account: target })
      console.log(`\x1b[32mSwitched active TikTok account to ${target} (${res.account})\x1b[0m`)
      return
    }

    if (subCmd === 'status') {
      const res = await callRpc('tiktok.status', { account })
      console.log(`\x1b[36m=== TikTok Status (${res.account || 'Account 1'})\x1b[0m\n`)
      console.log(`Authenticated: ${res.authenticated ? '\x1b[32mYES\x1b[0m' : '\x1b[33mNO (Guest Research Mode)\x1b[0m'}`)
      if (res.username) console.log(`Username: @${res.username}`)
      console.log(`Current URL: ${res.currentUrl}`)
      return
    }

    if (subCmd === 'feed') {
      const limit = Number(flags.limit || 15)
      const res = await callRpc('tiktok.feed', { limit, account })
      console.log(`\x1b[36m=== TikTok Trending & Explore Feed (${res.count || 0} found) ===\x1b[0m\n`)
      res.videos?.forEach((v, idx) => {
        console.log(`\x1b[33m[${idx + 1}] @${v.author}\x1b[0m (${v.views || 'N/A'} views)`)
        console.log(`    URL: ${v.url}`)
        if (v.title) console.log(`    Info: ${v.title}`)
        if (v.coverImg) console.log(`    Cover: ${v.coverImg.slice(0, 80)}...`)
      })
      return
    }

    if (subCmd === 'search') {
      const query = positional.join(' ') || flags.query || flags.q
      if (!query) {
        console.error('Usage: flowdesk tiktok search "<keyword or topic>" [--account 1|2] [--limit 15]')
        return
      }
      const limit = Number(flags.limit || 15)
      const res = await callRpc('tiktok.search', { query, limit, account })
      console.log(`\x1b[36m=== TikTok Search Results for "${query}" (${res.count || 0} found) ===\x1b[0m\n`)
      res.videos?.forEach((v, idx) => {
        const badge = v.topLiked ? ' \x1b[35m[TOP LIKED]\x1b[0m' : ''
        console.log(`\x1b[33m[${idx + 1}] @${v.author}\x1b[0m${badge} (${v.views || 'N/A'} views)`)
        console.log(`    URL: ${v.url}`)
        if (v.caption) console.log(`    Caption: ${v.caption}`)
      })
      return
    }

    if (subCmd === 'detail') {
      const url = flags.url || positional[0]
      if (!url) {
        console.error('Usage: flowdesk tiktok detail --url "<videoUrl>" [--account 1|2]')
        return
      }
      const res = await callRpc('tiktok.videoDetail', { url, account })
      console.log(`\x1b[36m=== TikTok Video Analytics ===\x1b[0m\n`)
      console.log(`URL: ${res.url}`)
      if (res.author) console.log(`Author: @${res.author}`)
      console.log(`Likes: ${res.likes || 'N/A'}`)
      console.log(`Comments: ${res.comments || 'N/A'}`)
      console.log(`Shares: ${res.shares || 'N/A'}`)
      if (res.caption) console.log(`Caption: ${res.caption}`)
      if (res.hashtags?.length) console.log(`Hashtags: ${res.hashtags.join(' ')}`)
      return
    }

    if (subCmd === 'suggest') {
      const seed = positional.join(' ') || flags.seed || flags.q
      if (!seed) {
        console.error('Usage: flowdesk tiktok suggest "<seedKeyword>" [--account 1|2]')
        return
      }
      const res = await callRpc('tiktok.suggest', { seed, account })
      console.log(`\x1b[36m=== TikTok SEO Keyword Suggestions for "${seed}" ===\x1b[0m\n`)
      console.log('\x1b[33mRecommended High-Intent Topics:\x1b[0m')
      res.recommendedKeywords?.forEach((kw, i) => console.log(`  [${i + 1}] ${kw}`))
      console.log('\n\x1b[33mTop Ranking Viral Hashtags:\x1b[0m')
      res.topHashtags?.forEach((h, i) => console.log(`  [${i + 1}] ${h.tag} (${h.occurrences} top videos)`))
      return
    }

    if (subCmd === 'outlier') {
      const creator = positional.join(' ') || flags.creator || flags.niche || flags.q
      if (!creator) {
        console.error('Usage: flowdesk tiktok outlier "<creatorHandle or niche>" [--account 1|2]')
        return
      }
      const res = await callRpc('tiktok.outlier', { creator, account })
      console.log(`\x1b[36m=== TikTok Outlier Analysis for "${res.creator}" ===\x1b[0m\n`)
      console.log(`Total Videos Analyzed: ${res.totalVideosAnalyzed}`)
      console.log(`Creator Baseline Median Views: \x1b[32m${res.medianViews.toLocaleString()} views\x1b[0m`)
      console.log(`Viral Outliers Found (>= 3.0x median): \x1b[35m${res.outlierCount}\x1b[0m\n`)

      if (res.outliers?.length === 0) {
        console.log('No statistical outliers (>= 3x) found in recent sample.')
      } else {
        res.outliers.forEach((o, idx) => {
          console.log(`\x1b[33m[#${idx + 1} ${o.viralityRating}]\x1b[0m ${o.outlierMultiplier}x MEDIAN (${o.views} views vs ${res.medianViews} median)`)
          console.log(`    URL: ${o.url}`)
          if (o.caption) console.log(`    Hook & Caption: ${o.caption.slice(0, 100)}...`)
        })
      }
      return
    }

    if (subCmd === 'upload') {
      const file = flags.file || positional[0]
      const caption = flags.caption || flags.c || 'Alpha Paws video #alphapaws #viral'
      const scheduleTime = flags.schedule || flags.time || flags.s
      if (!file) {
        console.error('Usage: flowdesk tiktok upload --file <videoPath> --caption "<caption with #hashtags>" [--schedule "<ISO-time>"] [--account 1|2]')
        return
      }
      console.log(`\x1b[36mUploading video to TikTok Studio (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      console.log(`File:     ${file}`)
      console.log(`Caption:  ${caption}`)
      if (scheduleTime) console.log(`Schedule: ${scheduleTime}`)
      console.log()
      const res = await callRpc('tiktok.uploadVideo', {
        videoFilePath: file,
        caption,
        scheduleTime,
        allowComment: flags.comments !== 'false',
        allowDuet: flags.duet !== 'false',
        account,
      })
      console.log('\x1b[32m=== TikTok Upload Result ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'publish') {
      console.log(`\x1b[36mPublishing video on TikTok Studio (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('tiktok.submitPost', { account })
      console.log('\x1b[32m=== TikTok Publish Result ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'posts' || subCmd === 'list') {
      console.log(`\x1b[36mFetching videos for TikTok (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('tiktok.listPosts', { account })
      console.log(`\x1b[32m=== TikTok Posts (${res.count || 0} found) ===\x1b[0m\n`)
      if (Array.isArray(res.posts) && res.posts.length > 0) {
        res.posts.forEach((p, idx) => {
          console.log(`  [${idx + 1}] ID: ${p.videoId} | Views: ${p.views || 'N/A'}`)
          console.log(`      URL: ${p.url}`)
          if (p.caption) console.log(`      Caption: ${p.caption.slice(0, 80)}...`)
        })
      } else {
        console.log('No posts found or account has no published videos.')
      }
      return
    }

    if (subCmd === 'delete') {
      const videoId = flags.id || flags.videoId || positional[0]
      const videoUrl = flags.url || flags.videoUrl
      if (!videoId && !videoUrl) {
        console.error('Usage: flowdesk tiktok delete --id <videoId> [--url <videoUrl>] [--account 1|2]')
        return
      }
      console.log(`\x1b[33mDeleting video ${videoId || videoUrl} from TikTok (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('tiktok.deleteVideo', { videoId, videoUrl, account })
      console.log('\x1b[32m=== TikTok Delete Result ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'delete-all') {
      const limit = flags.limit ? Number(flags.limit) : 100
      console.log(`\x1b[31;1m⚠️ WARNING: Starting bulk deletion of videos on TikTok (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      const res = await callRpc('tiktok.deleteAllVideos', { account, limit })
      console.log('\x1b[32m=== TikTok Bulk Deletion Result ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'warmup' || subCmd === 'scroll') {
      const seconds = flags.seconds || flags.duration || flags.s || 60
      const niche = flags.niche || positional[0]
      const autoLike = flags.like === 'true' || Boolean(flags.autoLike)
      console.log(`\x1b[36mStarting TikTok algorithm warmup & persona scroll (${account ? 'Account ' + account : 'Active Account'})...\x1b[0m`)
      console.log(`Duration:  ${seconds} seconds`)
      if (niche) console.log(`Niche:     ${niche}`)
      console.log(`Auto-Like: ${autoLike ? 'Enabled' : 'Disabled'}`)
      console.log()
      const res = await callRpc('tiktok.warmupScroll', {
        account,
        durationSeconds: Number(seconds),
        niche,
        autoLike,
      })
      console.log('\x1b[32m=== TikTok Warmup Result ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }
  }

  // ── SOCIAL ACCOUNTS (electron/socialAccounts.ts) ───────────────────────────
  if (command === 'social') {
    const sub = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))
    const fail = (msg) => { console.error(`\x1b[31m${msg}\x1b[0m`); process.exitCode = 1 }
    const platforms = ['whatsapp', 'tiktok', 'linkedin', 'reddit', 'facebook']
    if (sub === 'accounts') {
      const platform = positional[0]
      if (platform && !platforms.includes(platform)) return fail(`platform must be one of ${platforms.join(', ')}`)
      const res = await callRpc('social.accounts', { platform })
      for (const a of res.accounts) console.log(`${a.platform.padEnd(9)} ${a.id.padEnd(3)} ${String(a.signedIn === null ? 'unknown' : a.signedIn ? 'signed in' : 'signed out').padEnd(11)} ${a.label}  (${a.partition})`)
      return
    }
    if (sub === 'add') {
      if (!platforms.includes(positional[0])) return fail(`Usage: flowdesk social add <${platforms.join('|')}> [--label "<name>"]`)
      const res = await callRpc('social.addAccount', { platform: positional[0], label: typeof flags.label === 'string' ? flags.label : undefined })
      if (!res.ok) return fail(res.error)
      console.log(`added ${res.account.platform} account ${res.account.id} (${res.account.label}). Sign it in: flowdesk social login ${res.account.platform} ${res.account.id}`)
      return
    }
    if (sub === 'login') {
      if (!platforms.includes(positional[0])) return fail(`Usage: flowdesk social login <${platforms.join('|')}> [accountId]`)
      const res = await callRpc('social.openLogin', { platform: positional[0], account: positional[1] })
      return res.ok ? console.log(`sign-in window opened for ${res.account.platform} account ${res.account.id}`) : fail(res.error)
    }
    return fail('Usage: flowdesk social <accounts [platform]|add <platform> [--label name]|login <platform> [accountId]>')
  }

  // ── CHATGPT (electron/chatgptChats.ts + chatgptImages.ts) ──────────────────
  if (command === 'chatgpt') {
    const sub = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))
    const account = typeof flags.account === 'string' ? flags.account : undefined
    const num = (v) => (v === undefined || v === true ? undefined : Number(v))
    const show = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
    const fail = (msg) => { console.error(`\x1b[31m${msg}\x1b[0m`); process.exitCode = 1 }

    // Image jobs are queued without waiting and followed here, so the stage of
    // each one is printed as it changes and no single call has to stay open.
    const followJobs = async (queued) => {
      const ids = queued.jobs.map(j => j.id)
      const lastSeen = new Map()
      for (;;) {
        const all = await callRpc('chatgpt.imageJobs', {})
        const list = (Array.isArray(all) ? all : all.jobs || []).filter(j => ids.includes(j.id))
        for (const j of list) {
          const line = `${j.status}${j.stage ? ` · ${j.stage}` : ''}${j.account ? ` · ${j.account}` : ''}`
          if (lastSeen.get(j.id) !== line) { lastSeen.set(j.id, line); console.log(`[${j.id}] ${line}`) }
        }
        if (list.length && list.every(j => j.status === 'done' || j.status === 'failed')) {
          for (const j of list) {
            if (j.error) console.log(`\x1b[31m[${j.id}] ${j.error}\x1b[0m`)
            for (const img of j.images || []) console.log(`\x1b[32m[${j.id}]\x1b[0m ${img.path}`)
          }
          if (list.some(j => j.status === 'failed')) process.exitCode = 1
          return
        }
        await new Promise(r => setTimeout(r, 3000))
      }
    }

    if (sub === 'accounts') {
      const res = await callRpc('chatgpt.imageAccounts', { refresh: true })
      for (const a of res) console.log(`${a.account.padEnd(22)} ${String(a.plan ?? '?').padEnd(5)} signedIn=${a.signedIn} imagesLeft=${a.imagesLeft ?? '?'} ${a.parkedUntil ? `parked until ${a.parkedUntil}` : a.usable ? 'usable' : 'not usable'}  partition=${a.partition}`)
      return
    }
    if (sub === 'login') {
      if (!positional[0]) return fail('Usage: flowdesk chatgpt login <partition>   (partition from: flowdesk chatgpt accounts)')
      return show(await callRpc('chatgpt.openLogin', { partition: positional[0] }))
    }
    if (sub === 'models') return show(await callRpc('chatgpt.models', { account }))
    if (sub === 'chats') {
      const res = await callRpc('chatgpt.chats', { limit: num(flags.limit) ?? 10, account })
      for (const c of res.chats) console.log(`${c.id}  ${(c.updatedAt || '').slice(0, 16)}  ${c.account}  ${c.title}`)
      for (const e of res.errors || []) console.log(`\x1b[33m${e}\x1b[0m`)
      return
    }
    if (sub === 'read') {
      if (!positional[0]) return fail('Usage: flowdesk chatgpt read <chatId> [--last N]')
      const res = await callRpc('chatgpt.chatRead', { chatId: positional[0], account, lastN: num(flags.last) })
      if (!res.ok) return fail(res.error)
      for (const m of res.messages) console.log(`\x1b[36m${m.role}\x1b[0m ${m.text}${m.images.length ? `  [images: ${m.images.join(', ')}]` : ''}\n`)
      return
    }
    if (sub === 'search') {
      if (!positional.length) return fail('Usage: flowdesk chatgpt search "<words>"')
      const res = await callRpc('chatgpt.searchChats', { query: positional.join(' '), account, limit: num(flags.limit) })
      for (const h of res.hits) console.log(`${h.chatId}  ${h.account}  ${h.title}\n   ${(h.snippet || '').replace(/\s+/g, ' ').slice(0, 160)}`)
      return
    }
    if (sub === 'ask') {
      if (!positional.length) return fail('Usage: flowdesk chatgpt ask "<prompt>" [--chat <chatId>] [--account <email>] [--model <slug>]')
      const res = await callRpc('chatgpt.ask', { prompt: positional.join(' '), chatId: flags.chat, account, model: flags.model }, 15 * 60_000)
      if (!res.ok) return fail(res.error)
      console.log(`\x1b[32m=== ChatGPT (${res.account}, chat ${res.chatId}) ===\x1b[0m\n${res.text}`)
      for (const img of res.images || []) console.log(img.path)
      return
    }
    if (sub === 'image' || sub === 'edit') {
      const edit = sub === 'edit'
      const image = edit ? positional[0] : undefined
      const prompt = (edit ? positional.slice(1) : positional).join(' ')
      if (!prompt || (edit && !image)) return fail(edit ? 'Usage: flowdesk chatgpt edit <image path or flowdesk-image://…> "<change>" [--count N]' : 'Usage: flowdesk chatgpt image "<prompt>" [--count N] [--account <email>]')
      const queued = await callRpc(edit ? 'chatgpt.editImage' : 'chatgpt.generateImage', { prompt, image, count: num(flags.count), account, wait: false })
      return followJobs(queued)
    }
    if (sub === 'jobs') return show(await callRpc('chatgpt.imageJobs', positional[0] ? { jobId: positional[0] } : {}))
    if (sub === 'library') {
      const res = await callRpc('chatgpt.imageLibrary', { account, limit: num(flags.limit), cursor: flags.cursor })
      if (!res.ok) return fail(res.error)
      for (const i of res.images) console.log(`${i.fileId}  ${i.conversationId}  ${i.width}x${i.height}  ${(i.createdAt || '').slice(0, 16)}  ${i.title || ''}`)
      if (res.cursor) console.log(`\nnext page: --cursor ${res.cursor}`)
      return
    }
    if (sub === 'download') {
      if (positional.length < 2) return fail('Usage: flowdesk chatgpt download <fileId> <chatId> [--account <email>]')
      const res = await callRpc('chatgpt.downloadImage', { fileId: positional[0], conversationId: positional[1], account })
      return res.ok ? console.log(res.image.path) : fail(res.error)
    }
    if (sub === 'rename' || sub === 'archive' || sub === 'unarchive') {
      if (!positional[0] || (sub === 'rename' && !positional[1])) return fail('Usage: flowdesk chatgpt rename <chatId> "<title>" | archive <chatId> | unarchive <chatId>')
      const res = await callRpc('chatgpt.updateChat', sub === 'rename'
        ? { chatId: positional[0], title: positional.slice(1).join(' '), account }
        : { chatId: positional[0], archived: sub === 'archive', account })
      return res.ok ? show(res) : fail(res.error)
    }
    return fail('Usage: flowdesk chatgpt <accounts|login|models|chats|read|search|ask|image|edit|jobs|library|download|rename|archive|unarchive>')
  }

  // ── AI BROWSER WORKERS COMMAND ─────────────────────────────────────────────
  if (command === 'ask') {
    const provider = rawArgs[1]
    const prompt = rawArgs.slice(2).join(' ')
    const valid = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'deepseek']
    if (!valid.includes(provider) || !prompt) {
      console.error('Usage: flowdesk ask <chatgpt|claude|gemini|grok|perplexity|deepseek> "<prompt>"')
      return
    }
    console.log(`\x1b[36mAsking ${provider} via FlowDesk desktop session...\x1b[0m\n`)
    let sawImageProgress = false
    const stopListening = listenToGatewayEvents((event) => {
      if (event && event.type === 'image_progress' && event.tool === provider) {
        sawImageProgress = true
        renderProgressBar(event.percent, event.stage, event.elapsedSeconds)
      }
    })

    try {
      // An answer that draws an image can take several minutes.
      const res = await callRpc(`ask.${provider}`, { prompt }, 15 * 60_000)
      stopListening()
      if (sawImageProgress) {
        renderProgressBar(100, 'Image generated & ready for download/display', '')
        process.stdout.write('\n\n')
      }
      console.log(`\x1b[32m=== ${provider.toUpperCase()} Reply ===\x1b[0m\n${res}\n`)
    } catch (err) {
      stopListening()
      if (sawImageProgress) {
        process.stdout.write('\n')
      }
      throw err
    }
    return
  }

  // ── GOOGLE FLOW COMMANDS ───────────────────────────────────────────────────
  if (command === 'flow') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'projects') {
      const res = await callRpc('flow.listProjects')
      console.log('\x1b[36m=== Google Flow Projects ===\x1b[0m\n')
      res.projects?.forEach((p, idx) => {
        console.log(`[${idx + 1}] ${p.title} (ID: ${p.projectId || p.id})`)
      })
      return
    }

    if (subCmd === 'credits') {
      const res = await callRpc('flow.credits')
      console.log(`\x1b[36mFlow Credits:\x1b[0m ${JSON.stringify(res)}`)
      return
    }

    if (subCmd === 'image') {
      const projectId = flags.project || flags.proj
      const prompt = positional.join(' ') || flags.prompt
      if (!projectId || !prompt) {
        console.error('Usage: flowdesk flow image --project <id> --prompt "<detailed description>"')
        return
      }
      const confirmed = await confirmAction(`Generate image in Flow with prompt: "${prompt}"?`, Boolean(flags.yes))
      if (!confirmed) return
      console.log('Generating image in Google Flow...')
      const res = await callRpc('flow.generateImage', { projectId, prompt, aspectRatio: flags.ratio || 'LANDSCAPE' })
      console.log('\x1b[32mGeneration started!\x1b[0m', res)
      return
    }

    if (subCmd === 'video') {
      const projectId = flags.project || flags.projectId
      const prompt = flags.prompt || positional.join(' ')
      const modelKey = flags.model || 'abra_t2v_8s'
      if (!projectId || !prompt) {
        console.error('Usage: flowdesk flow video --project <id> --prompt "<prompt>" [--model abra_t2v_8s] [--yes]')
        return
      }
      const confirmed = await confirmAction(`Generate video: "${prompt}" using model ${modelKey}?`, Boolean(flags.yes))
      if (!confirmed) return
      console.log('Generating video in Google Flow...')
      const res = await callRpc('flow.generateVideo', { projectId, prompt, modelKey })
      console.log('\x1b[32mVideo generation submitted!\x1b[0m', res)
      return
    }

    if (subCmd === 'models') {
      const res = await callRpc('flow.videoModels')
      console.log('\x1b[36m=== Google Flow Video Models ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }
  }

  // ── FLOWDESK BRAIN COMMANDS ────────────────────────────────────────────────
  if (command === 'brain') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'status') {
      const res = await callRpc('brain.status')
      console.log('\x1b[36m=== FlowDesk Brain Status ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'overview') {
      const res = await callRpc('brain.overview', { scopeId: flags.scope })
      console.log('\x1b[36m=== Brain Overview ===\x1b[0m')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'search') {
      const query = positional.join(' ') || flags.query
      if (!query) {
        console.error('Usage: flowdesk brain search "<query>"')
        return
      }
      const res = await callRpc('brain.search', { query, scopeId: flags.scope })
      console.log(`\x1b[36m=== Brain Memories matching "${query}" ===\x1b[0m\n`)
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'remember') {
      const text = positional.join(' ') || flags.text
      if (!text) {
        console.error('Usage: flowdesk brain remember "<fact or insight to store>"')
        return
      }
      const res = await callRpc('brain.remember', { text, scopeId: flags.scope })
      console.log('\x1b[32mStored in Brain!\x1b[0m', res)
      return
    }

    if (subCmd === 'list') {
      const res = await callRpc('brain.listMemories', { scopeId: flags.scope })
      console.log('\x1b[36m=== Recent Brain Memories ===\x1b[0m\n')
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'answer') {
      const question = positional.join(' ') || flags.question
      if (!question) {
        console.error('Usage: flowdesk brain answer "<question>"')
        return
      }
      const res = await callRpc('brain.answerPack', { question, scopeId: flags.scope })
      console.log(`\x1b[36m=== Brain Knowledge Answer ===\x1b[0m\n`)
      console.log(JSON.stringify(res, null, 2))
      return
    }

    if (subCmd === 'doc') {
      const path = positional[0] || flags.path
      if (!path) {
        console.error('Usage: flowdesk brain doc <vault-path>')
        return
      }
      const res = await callRpc('brain.readDocument', { path, scopeId: flags.scope })
      console.log(`\x1b[36m=== Document: ${path} ===\x1b[0m\n`)
      console.log(JSON.stringify(res, null, 2))
      return
    }
  }

  // ── SKILLS COMMANDS ────────────────────────────────────────────────────────
  if (command === 'skills' || command === 'skill') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'list') {
      const domain = flags.domain || flags.d
      const skills = await callRpc('skills.list', { domain })
      console.log(`\x1b[36m=== FlowDesk Skills Registry ${domain ? '(' + domain + ')' : ''} ===\x1b[0m`)
      if (!Array.isArray(skills) || skills.length === 0) {
        console.log('No skills found.')
        return
      }
      console.log(`Found ${skills.length} skills:\n`)
      skills.forEach((s, idx) => {
        console.log(`\x1b[33m[${idx + 1}] ${s.name || s.id}\x1b[0m \x1b[90m(${s.id})\x1b[0m [domain: \x1b[32m${s.domain || 'general'}\x1b[0m]`)
        if (s.description) {
          console.log(`    ${s.description.slice(0, 120)}${s.description.length > 120 ? '...' : ''}`)
        }
        if (s.tools && s.tools.length > 0) {
          console.log(`    \x1b[90mTools: ${s.tools.join(', ')}\x1b[0m`)
        }
        console.log()
      })
      return
    }

    if (subCmd === 'get') {
      const id = positional[0] || flags.id
      if (!id) {
        console.error('Usage: flowdesk skills get <id>')
        return
      }
      const skill = await callRpc('skills.get', { id })
      if (!skill) {
        console.error(`\x1b[31mSkill "${id}" not found.\x1b[0m`)
        return
      }
      console.log(`\x1b[36m=== Skill: ${skill.name || skill.id} (${skill.id}) ===\x1b[0m`)
      console.log(`Domain:      ${skill.domain || 'general'}`)
      console.log(`Version:     ${skill.version || '1.0.0'}`)
      console.log(`Description: ${skill.description || 'N/A'}`)
      if (skill.tools && skill.tools.length > 0) {
        console.log(`Tools:       ${skill.tools.join(', ')}`)
      }
      if (skill.inputs && Object.keys(skill.inputs).length > 0) {
        console.log(`Inputs:      ${JSON.stringify(skill.inputs, null, 2)}`)
      }
      if (skill.playbook) {
        console.log(`\n\x1b[32m--- Playbook ---\x1b[0m\n${skill.playbook}`)
      }
      return
    }

    console.error('Usage: flowdesk skills <list|get> ...')
    return
  }

  // ── WORKFLOW COMMANDS ──────────────────────────────────────────────────────
  if (command === 'workflow' || command === 'workflows') {
    const subCmd = rawArgs[1]
    const { flags, positional } = parseFlags(rawArgs.slice(2))

    if (subCmd === 'list') {
      const domain = flags.domain || flags.d
      const workflows = await callRpc('workflows.list', { domain })
      console.log(`\x1b[36m=== FlowDesk Workflows ${domain ? '(' + domain + ')' : ''} ===\x1b[0m`)
      if (!Array.isArray(workflows) || workflows.length === 0) {
        console.log('No workflows found.')
        return
      }
      console.log(`Found ${workflows.length} workflows:\n`)
      workflows.forEach((w, idx) => {
        console.log(`\x1b[33m[${idx + 1}] ${w.name || w.id}\x1b[0m \x1b[90m(${w.id})\x1b[0m [steps: \x1b[32m${w.steps?.length || 0}\x1b[0m]`)
        if (w.description) {
          console.log(`    ${w.description.slice(0, 120)}${w.description.length > 120 ? '...' : ''}`)
        }
        if (w.domains && w.domains.length > 0) {
          console.log(`    \x1b[90mDomains: ${w.domains.join(', ')}\x1b[0m`)
        }
        console.log()
      })
      return
    }

    if (subCmd === 'run') {
      const id = positional[0] || flags.id
      if (!id) {
        console.error('Usage: flowdesk workflow run <id> [--inputs <json>]')
        return
      }
      let inputs = {}
      if (flags.inputs) {
        try {
          inputs = JSON.parse(flags.inputs)
        } catch {
          console.error('\x1b[31mInvalid JSON for --inputs\x1b[0m')
          return
        }
      }
      console.log(`\x1b[36mStarting workflow "${id}"...\x1b[0m\n`)
      const res = await callRpc('workflows.run', { id, inputs })
      console.log(`Status: ${res.status === 'completed' ? '\x1b[32mCOMPLETED\x1b[0m' : '\x1b[31m' + String(res.status || '').toUpperCase() + '\x1b[0m'}`)
      if (res.error) {
        console.log(`\x1b[31mError: ${res.error}\x1b[0m`)
      }
      if (res.stepResults) {
        console.log('\nSteps executed:')
        for (const [stepId, stepRes] of Object.entries(res.stepResults)) {
          const s = stepRes
          console.log(`  - \x1b[33m${stepId}\x1b[0m: ${s.status} (${s.durationMs}ms)`)
          if (s.error) console.log(`      Error: ${s.error}`)
          if (s.result) console.log(`      Result: ${JSON.stringify(s.result)}`)
        }
      }
      return
    }

    if (subCmd === 'runs') {
      const runs = await callRpc('workflows.runs', { workflowId: flags.id || positional[0] })
      console.log('\x1b[36m=== Recent Workflow Runs ===\x1b[0m\n')
      console.log(JSON.stringify(runs, null, 2))
      return
    }

    console.error('Usage: flowdesk workflow <list|run|runs> ...')
    return
  }

  printHelp()
}

function printHelp() {
  console.log(`
\x1b[36mFlowDesk CLI - Universal Local Desktop AI & Automation Hub\x1b[0m

Usage:
  flowdesk status                                    Check FlowDesk & provider status
  flowdesk mcp                                       Start stdio MCP server for AI agents

  flowdesk skills list [--domain <d>]                List available skills
  flowdesk skills get <id>                           View full skill playbook & inputs
  flowdesk workflow list                             List multi-skill workflows
  flowdesk workflow run <id> [--inputs <json>]       Execute a workflow

  flowdesk ask <chatgpt|claude|gemini|grok|perplexity> "<prompt>"
                                                     Query AI models via logged-in sessions

  flowdesk social accounts [platform]                Every social account and whether it is signed in
  flowdesk social add <platform> [--label name]      Add an account slot (whatsapp|tiktok|linkedin|reddit|facebook)
  flowdesk social login <platform> [accountId]       Open a sign-in window for that account

  flowdesk chatgpt accounts                          Sign-in, plan and image quota per account
  flowdesk chatgpt login <partition>                 Open a ChatGPT sign-in window for one account
  flowdesk chatgpt models [--account <email>]        Models the account can use
  flowdesk chatgpt chats [--limit N]                 Latest chats across all accounts
  flowdesk chatgpt read <chatId> [--last N]          What was said in one chat
  flowdesk chatgpt search "<words>"                  Full-text search over chats
  flowdesk chatgpt ask "<prompt>" [--chat id] [--model slug] [--account email]
                                                     New chat, or continue one
  flowdesk chatgpt image "<prompt>" [--count N]      Generate images (routes across accounts)
  flowdesk chatgpt edit <image> "<change>"           Edit an image (path or flowdesk-image://)
  flowdesk chatgpt jobs [jobId]                      Image job status
  flowdesk chatgpt library [--limit N] [--cursor c]  Every generated image, newest first
  flowdesk chatgpt download <fileId> <chatId>        Save one image to disk
  flowdesk chatgpt rename <chatId> "<title>"         Rename a chat (also: archive / unarchive)

  flowdesk brain status                              Check Brain health and vector index
  flowdesk brain search "<query>"                    Search semantic memories in Brain
  flowdesk brain remember "<fact>"                   Save a new memory into Brain
  flowdesk brain list                                List recent memories in Brain

  flowdesk flow projects                             List Google Flow projects
  flowdesk flow credits                              Check Google Flow credits
  flowdesk flow image --project id --prompt "..."    Generate image in Flow

  flowdesk reddit status                             View authenticated username & karma
  flowdesk reddit feed [--sub name] [--sort hot]     Browse subreddit or home feed
  flowdesk reddit outlier <subreddit> [--min-multiplier 3.0]
                                                     Mine viral breakout posts, pain points & hooks
  flowdesk reddit api-feed [--subreddit <s>] [--sort hot] [--limit 25]
                                                     Fast in-session Reddit feed JSON API (<300ms)
  flowdesk reddit api-search "<query>" [--subreddit <s>] [--limit 25]
                                                     Fast in-session Reddit search JSON API
  flowdesk reddit api-comments <postId> [--limit 20]
                                                     Fast in-session flattened Reddit comments
  flowdesk reddit comments --sub name --post id      Read comments on a post
  flowdesk reddit search "<query>"                   Search Reddit posts
  flowdesk reddit post --sub name --title "..."      Publish post (with approval prompt)
  flowdesk reddit comment --post id --text "..."     Post comment (with approval prompt)
  flowdesk reddit vote --post id --action UP|DOWN    Upvote or downvote a post

  flowdesk whatsapp chats [--limit 10]               List recent WhatsApp conversations
  flowdesk whatsapp api-chats [--limit 20] [--unread]
                                                     Fast in-session WhatsApp chat list
  flowdesk whatsapp api-messages <chatId> [--limit 20]
                                                     Fast in-session WhatsApp messages reader
  flowdesk whatsapp send --to <id> --message "..."   Send WhatsApp message

  flowdesk linkedin accounts                         List all connected LinkedIn accounts (Account 1, 2, etc.)
  flowdesk linkedin switch <1|2>                     Switch active displayed LinkedIn account in window
  flowdesk linkedin status [--account 1|2]           Check LinkedIn connection and profile status
  flowdesk linkedin feed [--account 1|2] [--limit 10] Browse LinkedIn feed
  flowdesk linkedin search "<query>" [--account 1|2] [--limit 10] Search LinkedIn posts, people, jobs & companies
  flowdesk linkedin outlier [--account 1|2] [--min-multiplier 3.0] Analyze viral breakout posts, hooks & formats
  flowdesk linkedin api-feed [--account 1|2] [--limit 20] Fast in-session Voyager LinkedIn feed
  flowdesk linkedin profile [--account 1|2]          View authenticated profile details & background
  flowdesk linkedin update-profile [--account 1|2] [--headline "..."]
                                                     Update headline, intro or summary/about
  flowdesk linkedin upload-photo <imagePath> [--account 1|2] Upload and set profile photo (avatar)
  flowdesk linkedin upload-cover <imagePath> [--account 1|2] Upload and set cover banner image
  flowdesk tiktok accounts                           List all connected TikTok accounts (Account 1, 2, etc.)
  flowdesk tiktok switch <1|2>                       Switch active displayed TikTok account in window
  flowdesk tiktok status [--account 1|2]             Check TikTok connection & guest mode
  flowdesk tiktok feed [--account 1|2] [--limit 10]  Browse trending & explore videos
  flowdesk tiktok search "<query>" [--account 1|2]   Search viral videos, hooks, and creators
  flowdesk tiktok detail --url "<videoUrl>"          Inspect video metrics, likes, shares & tags
  flowdesk tiktok suggest "<seedKeyword>"            Extract high-intent SEO topics & viral hashtags
  flowdesk tiktok outlier "<creatorHandle|niche>"    Mine breakout outlier videos (>= 3x median views)
  flowdesk tiktok upload --file <path> --caption "..." [--account 1|2]
                                                     Upload video to TikTok Studio for specific account
  flowdesk tiktok publish [--account 1|2]            Publish staged upload to TikTok with native trusted click
  flowdesk tiktok posts [--account 1|2]              List all published videos on account
  flowdesk tiktok delete --id <videoId> [--account 1|2]
                                                     Delete a single video by ID or URL
  flowdesk tiktok delete-all [--account 1|2] [--limit N]
                                                     Delete all videos from target TikTok account
`)
}

main().catch(err => {
  console.error('\x1b[31mError:\x1b[0m', err.message || err)
  process.exit(1)
})
