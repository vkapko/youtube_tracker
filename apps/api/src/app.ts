import express from 'express'
import videosRouter from './routes/videos'
import transcriptsRouter from './routes/transcripts'
import jobsRouter from './routes/jobs'
import channelsRouter from './routes/channels'
import searchRouter from './routes/search'
import summariesRouter from './routes/summaries'
import chatRouter from './routes/chat'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/videos', videosRouter)
app.use('/api/videos', transcriptsRouter)
app.use('/api/videos', summariesRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/channels', channelsRouter)
app.use('/api/search', searchRouter)
app.use('/api/chat', chatRouter)

export default app
