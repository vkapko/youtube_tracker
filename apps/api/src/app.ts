import express from 'express'
import videosRouter from './routes/videos'
import transcriptsRouter from './routes/transcripts'
import jobsRouter from './routes/jobs'
import channelsRouter from './routes/channels'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/videos', videosRouter)
app.use('/api/videos', transcriptsRouter)
app.use('/api/jobs', jobsRouter)
app.use('/api/channels', channelsRouter)

export default app
