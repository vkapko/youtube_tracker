import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AddVideoPage from './pages/AddVideoPage'
import VideoDetailPage from './pages/VideoDetailPage'
import SearchPage from './pages/SearchPage'
import ChatPage from './pages/ChatPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AddVideoPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/videos/:youtubeVideoId" element={<VideoDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}
