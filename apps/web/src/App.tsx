import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AddVideoPage from './pages/AddVideoPage'
import VideoDetailPage from './pages/VideoDetailPage'
import SearchPage from './pages/SearchPage'
import ChatPage from './pages/ChatPage'
import ChannelsPage from './pages/ChannelsPage'
import ChannelDetailPage from './pages/ChannelDetailPage'
import DashboardPage from './pages/DashboardPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AddVideoPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/videos/:youtubeVideoId" element={<VideoDetailPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </BrowserRouter>
  )
}
