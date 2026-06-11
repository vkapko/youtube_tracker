import express from 'express'
import videosRouter from './routes/videos'

const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/videos', videosRouter)

export default app
