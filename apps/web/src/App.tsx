import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AddVideoPage from './pages/AddVideoPage'
import VideoDetailPage from './pages/VideoDetailPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AddVideoPage />} />
        <Route path="/videos/:youtubeVideoId" element={<VideoDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}
