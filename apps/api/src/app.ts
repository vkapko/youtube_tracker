import express from 'express'
import videosRouter from './routes/videos'
import transcriptsRouter from './routes/transcripts'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/videos', videosRouter)
app.use('/api/videos', transcriptsRouter)

export default app
