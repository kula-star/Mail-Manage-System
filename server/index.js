import 'dotenv/config'
import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const distPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
app.use(express.json({ limit: '2mb' }))
const formFields = multer().none()

const User = mongoose.model('User', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  addressSequence: { type: Number, default: 0 },
  countries: { type: [String], default: ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'France', 'Japan', 'India', 'Brazil', 'Other'] },
}, { timestamps: true }))

const Address = mongoose.model('Address', new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  number: { type: Number, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  country: { type: String, required: true },
  addedAt: { type: String, required: true },
  replied: { type: Boolean, default: false },
  exported: { type: Boolean, default: false },
}, { timestamps: true }))
Address.schema.index({ owner: 1, email: 1 }, { unique: true })
Address.schema.index({ owner: 1, number: 1 }, { unique: true, partialFilterExpression: { number: { $type: 'number' } } })

const WebsiteTrack = mongoose.model('WebsiteTrack', new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, index: true },
  url: { type: String, required: true },
}, { timestamps: true }))
WebsiteTrack.schema.index({ owner: 1, url: 1 }, { unique: true })

const WebsiteView = mongoose.model('WebsiteView', new mongoose.Schema({
  url: { type: String, required: true, unique: true },
  views: { type: Number, default: 0 },
}, { timestamps: true }))

const Event = mongoose.model('Event', new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['Added', 'Removed', 'Output', 'Reply', 'Import', 'Country added', 'Country removed'], required: true },
  email: { type: String, required: true },
  country: { type: String, required: true },
  description: { type: String, default: '' },
  at: { type: String, required: true },
  quantity: { type: Number, default: 0 },
  totalCount: { type: Number, default: 0 },
  duplicateCount: { type: Number, default: 0 },
  invalidCount: { type: Number, default: 0 },
}))

const requireAuth = (request, response, next) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  try {
    if (!token) throw new Error('missing token')
    request.userId = jwt.verify(token, process.env.JWT_SECRET || 'local-development-secret-change-me').sub
    next()
  } catch {
    response.status(401).json({ error: 'Please sign in again.' })
  }
}

const userFromRequest = (request) => User.findById(request.userId)
const logEvent = (owner, type, email, country, quantity = 0, description = '') => Event.create({ owner, type, email, country, quantity, description, at: new Date().toISOString() })
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const normalizeWebsiteUrl = (value) => {
  const input = String(value || '').trim()
  if (!input || input.length > 2048) return null
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) return null
    return parsed.origin.toLowerCase()
  } catch {
    return null
  }
}
const reserveAddressNumbers = async (owner, count) => {
  const user = await User.findOneAndUpdate({ _id: owner }, { $inc: { addressSequence: count } }, { new: true }).select('addressSequence')
  return user.addressSequence - count + 1
}
const ensureAddressNumbers = async (owner) => {
  const [highest, unnumbered] = await Promise.all([
    Address.findOne({ owner, number: { $exists: true } }).sort({ number: -1 }).select('number').lean(),
    Address.find({ owner, number: { $exists: false } }).sort({ addedAt: 1, _id: 1 }).select('_id').lean(),
  ])
  if (highest?.number) await User.updateOne({ _id: owner }, { $max: { addressSequence: highest.number } })
  if (!unnumbered.length) return
  const firstNumber = await reserveAddressNumbers(owner, unnumbered.length)
  await Address.bulkWrite(unnumbered.map((address, index) => ({
    updateOne: {
      filter: { _id: address._id, number: { $exists: false } },
      update: { $set: { number: firstNumber + index } },
    },
  })))
}

app.post('/api/auth/signup', async (request, response) => {
  try {
    const email = String(request.body.email || '').trim().toLowerCase()
    const password = String(request.body.password || '')
    if (request.body.inviteCode !== (process.env.SIGNUP_CODE || 'goldluck')) return response.status(400).json({ error: 'That access code is not valid.' })
    if (!email || !validEmail(email) || password.length < 8) return response.status(400).json({ error: 'Enter a valid email and a password of at least 8 characters.' })
    const user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) })
    response.status(201).json({ token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '7d' }), email: user.email })
  } catch (error) {
    response.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? 'An account already exists for this email.' : 'Could not create account.' })
  }
})

app.post('/api/auth/signin', async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase()
  const user = await User.findOne({ email })
  if (!user || !(await bcrypt.compare(String(request.body.password || ''), user.passwordHash))) return response.status(401).json({ error: 'Email or password is incorrect.' })
  response.json({ token: jwt.sign({ sub: user.id }, process.env.JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '7d' }), email: user.email })
})

app.get('/api/data', requireAuth, async (request, response) => {
  await ensureAddressNumbers(request.userId)
  const [addresses, events, user, tracks] = await Promise.all([
    Address.find({ owner: request.userId }).sort({ addedAt: -1 }).lean(),
    Event.find({ owner: request.userId }).sort({ at: -1 }).lean(),
    userFromRequest(request),
    WebsiteTrack.find({ $or: [{ owner: request.userId }, { owner: null }] }).sort({ url: 1 }).lean(),
  ])
  const viewCounts = await WebsiteView.find({ url: { $in: tracks.map((item) => item.url) } }).lean()
  const countsByUrl = new Map(viewCounts.map((item) => [item.url, item.views]))
  response.json({ addresses: addresses.map((item) => ({ ...item, id: String(item._id) })), events: events.map((item) => ({ ...item, id: String(item._id) })), countries: user?.countries || [], tracks: tracks.map((item) => ({ ...item, id: String(item._id), views: countsByUrl.get(item.url) || 0 })) })
})

app.get('/api/tracks', requireAuth, async (request, response) => {
  const tracks = await WebsiteTrack.find({ $or: [{ owner: request.userId }, { owner: null }] }).sort({ url: 1 }).lean()
  response.json({ tracks: tracks.map((item) => ({ ...item, id: String(item._id) })) })
})

app.post('/api/tracks', requireAuth, async (request, response) => {
  const url = normalizeWebsiteUrl(request.body.url)
  if (!url) return response.status(400).json({ error: 'Enter a valid website URL.' })
  try {
    const track = await WebsiteTrack.create({ owner: request.userId, url })
    await WebsiteView.updateOne({ url }, { $setOnInsert: { url, views: 0 } }, { upsert: true })
    response.status(201).json({ ...track.toObject(), id: String(track._id), views: 0 })
  } catch (error) {
    response.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? 'That website is already being tracked.' : 'Could not add website.' })
  }
})

app.delete('/api/tracks/:id', requireAuth, async (request, response) => {
  const result = await WebsiteTrack.deleteOne({ _id: request.params.id, $or: [{ owner: request.userId }, { owner: null }] })
  response.json({ removed: result.deletedCount || 0 })
})

const setViewCorsHeaders = (response) => {
  response.set('Access-Control-Allow-Origin', '*')
  response.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.set('Access-Control-Allow-Headers', 'Content-Type')
}

app.options('/api/view', (_request, response) => {
  setViewCorsHeaders(response)
  response.sendStatus(204)
})

app.get('/api/view', async (request, response) => {
  setViewCorsHeaders(response)
  const url = normalizeWebsiteUrl(request.query.url || request.body?.url)
  if (!url) return response.status(400).json({ error: 'Provide a valid website URL using the url query parameter or JSON body.' })
  try {
    if (!await WebsiteTrack.exists({ url })) {
      try {
        await WebsiteTrack.create({ owner: null, url })
      } catch (error) {
        if (error.code !== 11000) throw error
      }
    }
    const counter = await WebsiteView.findOneAndUpdate({ url }, { $inc: { views: 1 }, $setOnInsert: { url } }, { new: true, upsert: true })
    response.json({ success: true, url, views: counter.views })
  } catch (error) {
    if (error.code === 11000) {
      const counter = await WebsiteView.findOneAndUpdate({ url }, { $inc: { views: 1 }, $setOnInsert: { url } }, { new: true, upsert: true })
      return response.json({ success: true, url, views: counter.views })
    }
    throw error
  }
})

app.post('/api/addresses', requireAuth, async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase()
  const country = String(request.body.country || '').trim()
  if (!validEmail(email)) return response.status(400).json({ error: 'Enter a valid email address.' })
  const user = await userFromRequest(request)
  if (!user?.countries.includes(country)) return response.status(400).json({ error: 'Select a country in your country list.' })
  try {
    await ensureAddressNumbers(request.userId)
    const number = await reserveAddressNumbers(request.userId, 1)
    const address = await Address.create({ owner: request.userId, number, email, country, addedAt: new Date().toISOString() })
    await logEvent(request.userId, 'Added', email, country, 0, `Manually added ${email} under ${country}.`)
    response.status(201).json({ ...address.toObject(), id: String(address._id) })
  } catch (error) {
    response.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? `${email} is already in your address book.` : 'Could not add address.' })
  }
})

app.post('/v1/addmailaddress', formFields, async (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase()
  if (!validEmail(email)) return response.status(400).json({ error: 'Enter a valid email address.' })
  const ownerEmail = String(request.body.ownerEmail || process.env.PUBLIC_API_OWNER_EMAIL || '').trim().toLowerCase()
  let user = ownerEmail ? await User.findOne({ email: ownerEmail }) : null
  if (!ownerEmail) {
    const accounts = await User.find().select('_id email countries').limit(2)
    if (accounts.length === 1) user = accounts[0]
    else return response.status(400).json({ error: 'Provide ownerEmail in the request or configure PUBLIC_API_OWNER_EMAIL.' })
  }
  if (!user) return response.status(400).json({ error: 'The requested owner account was not found.' })
  const knownCountry = user?.countries.find((item) => item.toLocaleLowerCase() === String(request.body.country || '').trim().toLocaleLowerCase())
  let country = knownCountry || 'Other'
  if (!user.countries.some((item) => item.toLocaleLowerCase() === 'other')) {
    user.countries.push('Other')
    await user.save()
  }
  try {
    await ensureAddressNumbers(user._id)
    const number = await reserveAddressNumbers(user._id, 1)
    const address = await Address.create({ owner: user._id, number, email, country, addedAt: new Date().toISOString() })
    await logEvent(user._id, 'Added', email, country, 0, `Added ${email} via API under ${country}.`)
    response.status(201).json({ success: true, address: { ...address.toObject(), id: String(address._id) }, countryFallback: !knownCountry })
  } catch (error) {
    response.status(error.code === 11000 ? 409 : 500).json({ error: error.code === 11000 ? `${email} is already in your address book.` : 'Could not add address.' })
  }
})

app.post('/api/addresses/import', requireAuth, async (request, response) => {
  const rows = Array.isArray(request.body.rows) ? request.body.rows : []
  await ensureAddressNumbers(request.userId)
  const existing = new Set((await Address.find({ owner: request.userId }).distinct('email')).map((value) => value.toLowerCase()))
  const user = await userFromRequest(request)
  let duplicates = 0
  let invalid = 0
  const additions = []
  const countriesByName = new Map(user.countries.map((country) => [country.toLocaleLowerCase(), country]))
  if (!countriesByName.has('other')) {
    user.countries.push('Other')
    countriesByName.set('other', 'Other')
    await user.save()
  }
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase()
    const providedCountry = String(row.country || '').trim()
    if (!validEmail(email)) { invalid++; continue }
    const country = countriesByName.get(providedCountry.toLocaleLowerCase()) || 'Other'
    if (existing.has(email)) { duplicates++; continue }
    existing.add(email)
    additions.push({ owner: request.userId, email, country, addedAt: new Date().toISOString() })
  }
  if (additions.length) {
    const firstNumber = await reserveAddressNumbers(request.userId, additions.length)
    additions.forEach((address, index) => { address.number = firstNumber + index })
    const inserted = await Address.insertMany(additions, { ordered: false })
    const at = new Date().toISOString()
    await Event.create({ owner: request.userId, type: 'Import', email: 'CSV import', country: 'All', at, quantity: inserted.length, totalCount: rows.length, duplicateCount: duplicates, invalidCount: invalid, description: `${inserted.length} addresses added from ${rows.length} rows; ${duplicates} duplicates.` })
  } else {
    await Event.create({ owner: request.userId, type: 'Import', email: 'CSV import', country: 'All', at: new Date().toISOString(), quantity: 0, totalCount: rows.length, duplicateCount: duplicates, invalidCount: invalid, description: `0 addresses added from ${rows.length} rows; ${duplicates} duplicates.` })
  }
  response.json({ added: additions.length, duplicates, invalid, total: rows.length })
})

app.delete('/api/addresses', requireAuth, async (request, response) => {
  const ids = Array.isArray(request.body.ids) ? request.body.ids : []
  const removed = await Address.find({ owner: request.userId, _id: { $in: ids } }).lean()
  if (removed.length) {
    await Address.deleteMany({ owner: request.userId, _id: { $in: removed.map((item) => item._id) } })
    await Event.insertMany(removed.map((item) => ({ owner: request.userId, type: 'Removed', email: item.email, country: item.country, at: new Date().toISOString(), description: `Removed ${item.email} from ${item.country}.` })))
  }
  response.json({ removed: removed.length })
})

app.delete('/api/addresses/all', requireAuth, async (request, response) => {
  const result = await Address.deleteMany({ owner: request.userId })
  const removed = result.deletedCount || 0
  if (removed) await logEvent(request.userId, 'Removed', 'All addresses', 'All', removed, `Removed all ${removed} addresses.`)
  response.json({ removed })
})

app.patch('/api/addresses/:id/reply', requireAuth, async (request, response) => {
  const address = await Address.findOneAndUpdate({ _id: request.params.id, owner: request.userId, replied: false }, { replied: true }, { new: true })
  if (address) await logEvent(request.userId, 'Reply', address.email, address.country, 0, `Marked ${address.email} as replied.`)
  response.json({ ok: true })
})

app.delete('/api/history', requireAuth, async (request, response) => {
  const result = await Event.deleteMany({ owner: request.userId })
  response.json({ cleared: result.deletedCount || 0 })
})

app.post('/api/exports', requireAuth, async (request, response) => {
  const { start, end, ids } = request.body
  const query = { owner: request.userId }
  if (Array.isArray(ids)) {
    if (!ids.length) return response.status(400).json({ error: 'Select at least one address to export.' })
    query._id = { $in: ids }
  } else if (start !== undefined || end !== undefined) {
    const first = Number(start); const last = Number(end)
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return response.status(400).json({ error: 'Enter a valid 1-based range.' })
  }
  const addresses = await Address.find(query).sort({ number: 1 }).lean()
  const addressesById = new Map(addresses.map((address) => [String(address._id), address]))
  const first = start === undefined ? 1 : Number(start)
  const last = end === undefined ? addresses.length : Number(end)
  if (!Array.isArray(ids) && (first > addresses.length || last > addresses.length)) return response.status(400).json({ error: `Choose a range between 1 and ${addresses.length}.` })
  const rows = Array.isArray(ids)
    ? [...new Set(ids.map(String))].map((id) => addressesById.get(id)).filter(Boolean)
    : addresses.slice(first - 1, last)
  if (rows.length) await Address.updateMany({ owner: request.userId, _id: { $in: rows.map((row) => row._id) } }, { $set: { exported: true } })
  if (rows.length) await logEvent(request.userId, 'Output', `${rows.length} addresses`, 'All', rows.length, `Exported ${rows.length} selected email address${rows.length === 1 ? '' : 'es'}.`)
  response.json({ emails: rows.map((row) => row.email), count: rows.length, markedExported: rows.length })
})

app.post('/api/countries', requireAuth, async (request, response) => {
  const country = String(request.body.country || '').trim()
  if (!country || country.length > 80) return response.status(400).json({ error: 'Enter a country name up to 80 characters.' })
  const user = await userFromRequest(request)
  if (user.countries.some((item) => item.toLocaleLowerCase() === country.toLocaleLowerCase())) return response.status(409).json({ error: 'That country is already in your list.' })
  user.countries.push(country)
  await user.save()
  await logEvent(request.userId, 'Country added', country, country, 0, `Added country: ${country}.`)
  response.status(201).json({ countries: user.countries })
})

app.delete('/api/countries/:country', requireAuth, async (request, response) => {
  const country = decodeURIComponent(request.params.country)
  if (await Address.exists({ owner: request.userId, country })) return response.status(409).json({ error: 'This country is assigned to addresses. Move or remove those addresses first.' })
  const user = await userFromRequest(request)
  user.countries = user.countries.filter((item) => item !== country)
  await user.save()
  await logEvent(request.userId, 'Country removed', country, country, 0, `Removed country: ${country}.`)
  response.json({ countries: user.countries })
})

app.get('/api/health', (_request, response) => response.json({ ok: true, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }))

app.use(express.static(distPath))
app.get(/.*/, (request, response, next) => {
  if (request.path.startsWith('/api/') || request.path.startsWith('/v1/')) return next()
  response.sendFile(resolve(distPath, 'index.html'), (error) => {
    if (error) next(error)
  })
})

const port = Number(process.env.PORT || process.env.API_PORT || 3001)
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mail_manage_system'
try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  app.listen(port, () => console.log(`Mail management API listening on http://127.0.0.1:${port}`))
} catch (error) {
  console.error(`Could not connect to MongoDB at ${mongoUri}. Start local MongoDB or set MONGODB_URI.`, error.message)
  process.exit(1)
}