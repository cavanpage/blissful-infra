import { useState, useEffect, useRef } from 'react'
import {
  Play,
  Square,
  RefreshCw,
  Terminal,
  MessageSquare,
  Activity,
  Send,
  Loader2,
} from 'lucide-react'

interface Project {
  name: string
  status: 'running' | 'stopped' | 'unknown'
  services: Service[]
}

interface Service {
  name: string
  status: 'running' | 'stopped' | 'starting'
  port?: number
}

interface LogEntry {
  timestamp: string
  service: string
  message: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function App() {
  const [project, setProject] = useState<Project | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'chat'>('logs')
  const [agentLoading, setAgentLoading] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status')
      if (res.ok) {
        const data = await res.json()
        setProject(data)
      }
    } catch (e) {
      console.error('Failed to fetch status:', e)
    }
  }

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs')
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e)
    }
  }

  useEffect(() => {
    fetchStatus()
    fetchLogs()
    const statusInterval = setInterval(fetchStatus, 5000)
    const logsInterval = setInterval(fetchLogs, 3000)
    return () => {
      clearInterval(statusInterval)
      clearInterval(logsInterval)
    }
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStart = async () => {
    setLoading(true)
    try {
      await fetch('/api/up', { method: 'POST' })
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    setLoading(true)
    try {
      await fetch('/api/down', { method: 'POST' })
      await fetchStatus()
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || agentLoading) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setAgentLoading(true)

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.response },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Error: Failed to get response from agent' },
        ])
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Error: Could not connect to agent' },
      ])
    } finally {
      setAgentLoading(false)
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-green-400'
      case 'stopped':
        return 'text-red-400'
      case 'starting':
        return 'text-yellow-400'
      default:
        return 'text-gray-400'
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-semibold">blissful-infra</h1>
          </div>
          <button
            onClick={fetchStatus}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar - Project Status */}
        <aside className="w-80 border-r border-gray-800 p-4 flex flex-col">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
            Project
          </h2>

          {project ? (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">{project.name}</span>
                  <span className={`text-sm ${statusColor(project.status)}`}>
                    {project.status}
                  </span>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={handleStart}
                    disabled={loading || project.status === 'running'}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Start
                  </button>
                  <button
                    onClick={handleStop}
                    disabled={loading || project.status === 'stopped'}
                    className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                    Stop
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-2">Services</h3>
                <div className="space-y-2">
                  {project.services.map((service) => (
                    <div
                      key={service.name}
                      className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg"
                    >
                      <span className="text-sm">{service.name}</span>
                      <div className="flex items-center gap-2">
                        {service.port && (
                          <a
                            href={`http://localhost:${service.port}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-400 hover:underline"
                          >
                            :{service.port}
                          </a>
                        )}
                        <span
                          className={`w-2 h-2 rounded-full ${
                            service.status === 'running'
                              ? 'bg-green-400'
                              : service.status === 'starting'
                              ? 'bg-yellow-400'
                              : 'bg-red-400'
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">
              No project detected. Run from a blissful-infra project directory.
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'logs'
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Terminal className="w-4 h-4" />
              Logs
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === 'chat'
                  ? 'border-blue-400 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              Agent
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'logs' ? (
            <div className="flex-1 overflow-auto p-4 font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-500">No logs available</div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-gray-500 shrink-0">
                        [{log.service}]
                      </span>
                      <span
                        className={
                          log.message.toLowerCase().includes('error')
                            ? 'text-red-400'
                            : log.message.toLowerCase().includes('warn')
                            ? 'text-yellow-400'
                            : 'text-gray-300'
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {/* Chat Messages */}
              <div className="flex-1 overflow-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-gray-500 text-center py-8">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Ask the agent about your infrastructure</p>
                    <p className="text-sm mt-2">
                      Try: "What errors are in the logs?" or "Why might Kafka be failing?"
                    </p>
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-2 rounded-lg ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800 text-gray-100'
                        }`}
                      >
                        <pre className="whitespace-pre-wrap font-sans">
                          {msg.content}
                        </pre>
                      </div>
                    </div>
                  ))
                )}
                {agentLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-800 px-4 py-2 rounded-lg">
                      <Loader2 className="w-5 h-5 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <form
                onSubmit={handleSendMessage}
                className="border-t border-gray-800 p-4"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask the agent..."
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || agentLoading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg transition-colors"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </form>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
