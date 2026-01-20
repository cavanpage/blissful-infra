import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Play,
  Square,
  RefreshCw,
  Terminal,
  MessageSquare,
  Activity,
  Send,
  Loader2,
  Plus,
  Trash2,
  FolderOpen,
  ChevronRight,
  AlertCircle,
  Copy,
  Check,
  X,
  Cpu,
  HardDrive,
  Network,
  BarChart3,
} from 'lucide-react'

interface Project {
  name: string
  path: string
  status: 'running' | 'stopped' | 'unknown'
  type: string
  backend?: string
  frontend?: string
  database?: string
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

interface Templates {
  types: string[]
  backends: string[]
  frontends: string[]
  databases: string[]
}

interface OllamaModel {
  name: string
  size: number
  modifiedAt: string
}

interface ModelsResponse {
  available: boolean
  models: OllamaModel[]
  recommended?: string
  error?: string
}

interface ContainerMetrics {
  name: string
  cpuPercent: number
  memoryUsage: number
  memoryLimit: number
  memoryPercent: number
  networkRx: number
  networkTx: number
}

interface HttpMetrics {
  totalRequests: number
  requestsPerSecond: number
  avgResponseTime: number
}

interface MetricsResponse {
  containers: ContainerMetrics[]
  httpMetrics?: HttpMetrics
  timestamp: number
}

interface MetricsHistory {
  timestamps: number[]
  containers: Record<string, { cpu: number[]; memory: number[] }>
  http: {
    requestsPerSecond: number[]
    avgResponseTime: number[]
    lastTotalRequests: number
  }
}

function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'logs' | 'chat' | 'metrics'>('logs')
  const [agentLoading, setAgentLoading] = useState(false)
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory>({
    timestamps: [],
    containers: {},
    http: { requestsPerSecond: [], avgResponseTime: [], lastTotalRequests: 0 },
  })
  const [metricsLoaded, setMetricsLoaded] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [templates, setTemplates] = useState<Templates | null>(null)
  const [creating, setCreating] = useState(false)
  const [models, setModels] = useState<ModelsResponse | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // New project form state
  const [newProject, setNewProject] = useState({
    name: '',
    type: 'fullstack',
    backend: 'spring-boot',
    frontend: 'react-vite',
    database: 'none',
  })

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
        // Update selected project if it exists
        if (selectedProject) {
          const updated = data.projects.find((p: Project) => p.name === selectedProject.name)
          if (updated) setSelectedProject(updated)
        }
      }
    } catch (e) {
      console.error('Failed to fetch projects:', e)
    }
  }

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
      }
    } catch (e) {
      console.error('Failed to fetch templates:', e)
    }
  }

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data: ModelsResponse = await res.json()
        setModels(data)
        // Set default to recommended model if not already selected
        if (!selectedModel && data.recommended) {
          setSelectedModel(data.recommended)
        }
      }
    } catch (e) {
      console.error('Failed to fetch models:', e)
    }
  }

  const fetchLogs = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/logs`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e)
    }
  }

  const fetchMetrics = async () => {
    if (!selectedProject) return
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/metrics`)
      if (res.ok) {
        const data: MetricsResponse = await res.json()
        setMetricsLoaded(true)

        if (data.containers.length === 0) {
          // No containers running - keep metricsLoaded true but containers empty
          return
        }

        setMetricsHistory((prev) => {
          const maxDataPoints = 30 // Keep last 30 data points (~30 seconds of history)
          const newTimestamps = [...prev.timestamps, data.timestamp].slice(-maxDataPoints)
          const newContainers = { ...prev.containers }

          for (const container of data.containers) {
            if (!newContainers[container.name]) {
              newContainers[container.name] = { cpu: [], memory: [] }
            }
            newContainers[container.name].cpu = [
              ...newContainers[container.name].cpu,
              container.cpuPercent,
            ].slice(-maxDataPoints)
            newContainers[container.name].memory = [
              ...newContainers[container.name].memory,
              container.memoryPercent,
            ].slice(-maxDataPoints)
          }

          // Calculate HTTP metrics (requests per second from delta)
          const newHttp = { ...prev.http }
          if (data.httpMetrics) {
            const deltaRequests = data.httpMetrics.totalRequests - prev.http.lastTotalRequests
            const rps = prev.http.lastTotalRequests > 0 ? Math.max(0, deltaRequests) : 0
            newHttp.requestsPerSecond = [...prev.http.requestsPerSecond, rps].slice(-maxDataPoints)
            newHttp.avgResponseTime = [...prev.http.avgResponseTime, data.httpMetrics.avgResponseTime].slice(-maxDataPoints)
            newHttp.lastTotalRequests = data.httpMetrics.totalRequests
          }

          return { timestamps: newTimestamps, containers: newContainers, http: newHttp }
        })
      }
    } catch (e) {
      console.error('Failed to fetch metrics:', e)
      setMetricsLoaded(true) // Mark as loaded even on error
    }
  }

  useEffect(() => {
    fetchProjects()
    fetchTemplates()
    fetchModels()
    const interval = setInterval(fetchProjects, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedProject) {
      fetchLogs()
      const interval = setInterval(fetchLogs, 3000)
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name])

  useEffect(() => {
    if (selectedProject && activeTab === 'metrics') {
      // Clear history when switching projects or tabs
      setMetricsHistory({
        timestamps: [],
        containers: {},
        http: { requestsPerSecond: [], avgResponseTime: [], lastTotalRequests: 0 },
      })
      setMetricsLoaded(false)
      fetchMetrics()
      const interval = setInterval(fetchMetrics, 1000) // Fetch every second
      return () => clearInterval(interval)
    }
  }, [selectedProject?.name, activeTab])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStart = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/up`, { method: 'POST' })
      const data = await res.json()
      if (!data.success && data.error) {
        setErrorModal({
          title: 'Failed to start project',
          message: data.error,
        })
      }
      await fetchProjects()
    } catch (e) {
      setErrorModal({
        title: 'Failed to start project',
        message: e instanceof Error ? e.message : 'Network error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleStop = async () => {
    if (!selectedProject) return
    setLoading(true)
    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/down`, { method: 'POST' })
      const data = await res.json()
      if (!data.success && data.error) {
        setErrorModal({
          title: 'Failed to stop project',
          message: data.error,
        })
      }
      await fetchProjects()
    } catch (e) {
      setErrorModal({
        title: 'Failed to stop project',
        message: e instanceof Error ? e.message : 'Network error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (projectName: string) => {
    if (!confirm(`Delete project "${projectName}"? This will stop all containers and remove the directory.`)) {
      return
    }
    try {
      await fetch(`/api/projects/${projectName}`, { method: 'DELETE' })
      if (selectedProject?.name === projectName) {
        setSelectedProject(null)
      }
      await fetchProjects()
    } catch (e) {
      console.error('Failed to delete project:', e)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProject.name.trim()) return

    setCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProject),
      })
      const data = await res.json()
      if (data.success) {
        setShowCreateModal(false)
        setNewProject({
          name: '',
          type: 'fullstack',
          backend: 'spring-boot',
          frontend: 'react-vite',
          database: 'none',
        })
        await fetchProjects()
      } else {
        setErrorModal({
          title: 'Failed to create project',
          message: data.error || 'An unknown error occurred',
        })
      }
    } catch (e) {
      console.error('Failed to create project:', e)
      setErrorModal({
        title: 'Failed to create project',
        message: e instanceof Error ? e.message : 'Network error - could not reach server',
      })
    } finally {
      setCreating(false)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || agentLoading || !selectedProject) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setAgentLoading(true)

    try {
      const res = await fetch(`/api/projects/${selectedProject.name}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage, model: selectedModel || undefined }),
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

  const statusDot = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-400'
      case 'stopped':
        return 'bg-red-400'
      case 'starting':
        return 'bg-yellow-400'
      default:
        return 'bg-gray-400'
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
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">orchestrator</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
            <button
              onClick={fetchProjects}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar - Projects List */}
        <aside className="w-80 border-r border-gray-800 p-4 flex flex-col">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-4">
            Projects ({projects.length})
          </h2>

          {projects.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No projects found</p>
              <p className="text-xs mt-2">Click "New Project" to create one</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-auto flex-1">
              {projects.map((project) => (
                <div
                  key={project.name}
                  className={`group bg-gray-800 rounded-lg p-3 cursor-pointer transition-colors ${
                    selectedProject?.name === project.name
                      ? 'ring-2 ring-blue-500'
                      : 'hover:bg-gray-750'
                  }`}
                  onClick={() => {
                    setSelectedProject(project)
                    setMessages([]) // Clear chat when switching projects
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${statusDot(project.status)}`} />
                      <span className="font-medium">{project.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(project.name)
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-700 rounded transition-all"
                        title="Delete project"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {project.type} {project.backend && `/ ${project.backend}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col">
          {selectedProject ? (
            <>
              {/* Project Header */}
              <div className="border-b border-gray-800 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
                    <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                      <span className={statusColor(selectedProject.status)}>
                        {selectedProject.status}
                      </span>
                      <span>-</span>
                      <span>{selectedProject.type}</span>
                      {selectedProject.backend && <span>/ {selectedProject.backend}</span>}
                      {selectedProject.database && selectedProject.database !== 'none' && (
                        <span>/ {selectedProject.database}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleStart}
                      disabled={loading || selectedProject.status === 'running'}
                      className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
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
                      disabled={loading || selectedProject.status === 'stopped'}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 px-3 py-2 rounded-lg transition-colors"
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

                {/* Services */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedProject.services.map((service) => (
                    <div
                      key={service.name}
                      className="flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg text-sm"
                    >
                      <span className={`w-2 h-2 rounded-full ${statusDot(service.status)}`} />
                      <span>{service.name}</span>
                      {service.port && (
                        <a
                          href={`http://localhost:${service.port}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          :{service.port}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>

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
                <button
                  onClick={() => setActiveTab('metrics')}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                    activeTab === 'metrics'
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  Metrics
                </button>
              </div>

              {/* Tab Content */}
              {activeTab === 'logs' ? (
                <div className="flex-1 overflow-auto p-4 font-mono text-sm">
                  {logs.length === 0 ? (
                    <div className="text-gray-500">No logs available. Start the project to see logs.</div>
                  ) : (
                    <div className="space-y-1">
                      {logs.map((log, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-gray-500 shrink-0">[{log.service}]</span>
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
              ) : activeTab === 'chat' ? (
                <div className="flex-1 flex flex-col">
                  {/* Model Selector */}
                  <div className="border-b border-gray-800 px-4 py-3 flex items-center gap-3">
                    <label className="text-sm text-gray-400">Model:</label>
                    {!models?.available ? (
                      <span className="text-sm text-yellow-400">
                        Ollama not running - start with `ollama serve`
                      </span>
                    ) : models.models.length === 0 ? (
                      <span className="text-sm text-yellow-400">
                        No models - pull one with `ollama pull llama3.1:8b`
                      </span>
                    ) : (
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                      >
                        {models.models.map((model) => (
                          <option key={model.name} value={model.name}>
                            {model.name}
                            {model.name === models.recommended ? ' (recommended)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={fetchModels}
                      className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                      title="Refresh models"
                    >
                      <RefreshCw className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>

                  {/* Chat Messages */}
                  <div className="flex-1 overflow-auto p-4 space-y-4">
                    {messages.length === 0 ? (
                      <div className="text-gray-500 text-center py-8">
                        <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>Ask the agent about {selectedProject.name}</p>
                        <p className="text-sm mt-2">
                          Try: "What errors are in the logs?" or "Why might Kafka be failing?"
                        </p>
                      </div>
                    ) : (
                      messages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[80%] px-4 py-2 rounded-lg ${
                              msg.role === 'user'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-800 text-gray-100'
                            }`}
                          >
                            {msg.role === 'user' ? (
                              <span>{msg.content}</span>
                            ) : (
                              <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-headings:my-2 prose-ul:my-2 prose-ol:my-2 prose-pre:my-2 prose-pre:bg-gray-900 prose-pre:rounded-lg prose-code:bg-gray-900 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {msg.content}
                                </ReactMarkdown>
                              </div>
                            )}
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
                  <form onSubmit={handleSendMessage} className="border-t border-gray-800 p-4">
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
              ) : activeTab === 'metrics' ? (
                <div className="flex-1 overflow-auto p-4">
                  {!metricsLoaded ? (
                    <div className="text-gray-500 text-center py-8">
                      <Loader2 className="w-12 h-12 mx-auto mb-3 opacity-50 animate-spin" />
                      <p>Loading metrics...</p>
                    </div>
                  ) : Object.keys(metricsHistory.containers).length === 0 ? (
                    <div className="text-gray-500 text-center py-8">
                      <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No containers running</p>
                      <p className="text-sm mt-2">Start the project to see metrics</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {Object.entries(metricsHistory.containers).map(([containerName, data]) => (
                        <div key={containerName} className="bg-gray-800 rounded-lg p-4">
                          <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                            <HardDrive className="w-5 h-5 text-blue-400" />
                            {containerName}
                          </h3>

                          <div className="grid grid-cols-2 gap-6">
                            {/* CPU Usage */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400 flex items-center gap-2">
                                  <Cpu className="w-4 h-4" />
                                  CPU Usage
                                </span>
                                <span className="text-sm font-mono">
                                  {data.cpu.length > 0 ? data.cpu[data.cpu.length - 1].toFixed(1) : 0}%
                                </span>
                              </div>
                              <div className="h-20 bg-gray-900 rounded-lg p-2 flex items-end gap-0.5">
                                {data.cpu.map((value, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 bg-blue-500 rounded-sm transition-all"
                                    style={{ height: `${Math.min(value, 100)}%` }}
                                  />
                                ))}
                                {data.cpu.length === 0 && (
                                  <div className="flex-1 text-center text-gray-600 text-sm">No data</div>
                                )}
                              </div>
                            </div>

                            {/* Memory Usage */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400 flex items-center gap-2">
                                  <HardDrive className="w-4 h-4" />
                                  Memory Usage
                                </span>
                                <span className="text-sm font-mono">
                                  {data.memory.length > 0 ? data.memory[data.memory.length - 1].toFixed(1) : 0}%
                                </span>
                              </div>
                              <div className="h-20 bg-gray-900 rounded-lg p-2 flex items-end gap-0.5">
                                {data.memory.map((value, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 bg-green-500 rounded-sm transition-all"
                                    style={{ height: `${Math.min(value, 100)}%` }}
                                  />
                                ))}
                                {data.memory.length === 0 && (
                                  <div className="flex-1 text-center text-gray-600 text-sm">No data</div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Progress bars for current values */}
                          <div className="mt-4 space-y-3">
                            <div>
                              <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span>CPU</span>
                                <span>{data.cpu.length > 0 ? data.cpu[data.cpu.length - 1].toFixed(2) : 0}%</span>
                              </div>
                              <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 transition-all duration-300"
                                  style={{ width: `${Math.min(data.cpu[data.cpu.length - 1] || 0, 100)}%` }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span>Memory</span>
                                <span>{data.memory.length > 0 ? data.memory[data.memory.length - 1].toFixed(2) : 0}%</span>
                              </div>
                              <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 transition-all duration-300"
                                  style={{ width: `${Math.min(data.memory[data.memory.length - 1] || 0, 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* HTTP Request Metrics */}
                      <div className="bg-gray-800 rounded-lg p-4">
                        <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                          <Network className="w-5 h-5 text-purple-400" />
                          HTTP Requests
                        </h3>

                        {metricsHistory.http.requestsPerSecond.length === 0 ? (
                          <p className="text-sm text-gray-500">
                            No HTTP metrics available. Metrics are collected from Spring Boot Actuator on port 8080.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 gap-6">
                            {/* Requests per Second */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Requests/sec</span>
                                <span className="text-sm font-mono">
                                  {metricsHistory.http.requestsPerSecond.length > 0
                                    ? metricsHistory.http.requestsPerSecond[metricsHistory.http.requestsPerSecond.length - 1]
                                    : 0}
                                </span>
                              </div>
                              <div className="h-20 bg-gray-900 rounded-lg p-2 flex items-end gap-0.5">
                                {metricsHistory.http.requestsPerSecond.map((value, i) => {
                                  const maxRps = Math.max(...metricsHistory.http.requestsPerSecond, 1)
                                  return (
                                    <div
                                      key={i}
                                      className="flex-1 bg-purple-500 rounded-sm transition-all"
                                      style={{ height: `${(value / maxRps) * 100}%` }}
                                    />
                                  )
                                })}
                              </div>
                            </div>

                            {/* Average Response Time */}
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Avg Response Time</span>
                                <span className="text-sm font-mono">
                                  {metricsHistory.http.avgResponseTime.length > 0
                                    ? metricsHistory.http.avgResponseTime[metricsHistory.http.avgResponseTime.length - 1].toFixed(1)
                                    : 0}
                                  ms
                                </span>
                              </div>
                              <div className="h-20 bg-gray-900 rounded-lg p-2 flex items-end gap-0.5">
                                {metricsHistory.http.avgResponseTime.map((value, i) => {
                                  const maxTime = Math.max(...metricsHistory.http.avgResponseTime, 1)
                                  return (
                                    <div
                                      key={i}
                                      className="flex-1 bg-yellow-500 rounded-sm transition-all"
                                      style={{ height: `${(value / maxTime) * 100}%` }}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">Select a project to get started</p>
                <p className="text-sm mt-2">or create a new one with the button above</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Name</label>
                <input
                  type="text"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  placeholder="my-awesome-app"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">Project Type</label>
                <select
                  value={newProject.type}
                  onChange={(e) => setNewProject({ ...newProject, type: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                >
                  {templates?.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {newProject.type !== 'frontend' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Backend</label>
                  <select
                    value={newProject.backend}
                    onChange={(e) => setNewProject({ ...newProject, backend: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  >
                    {templates?.backends.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {newProject.type !== 'backend' && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Frontend</label>
                  <select
                    value={newProject.frontend}
                    onChange={(e) => setNewProject({ ...newProject, frontend: e.target.value })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                  >
                    {templates?.frontends.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-400 mb-1">Database</label>
                <select
                  value={newProject.database}
                  onChange={(e) => setNewProject({ ...newProject, database: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
                >
                  {templates?.databases.map((d) => (
                    <option key={d} value={d}>
                      {d === 'none' ? 'None' : d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newProject.name.trim() || creating}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Error Modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-6 h-6 text-red-400" />
                <h2 className="text-xl font-semibold text-red-400">{errorModal.title}</h2>
              </div>
              <button
                onClick={() => setErrorModal(null)}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="relative">
              <pre className="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                {errorModal.message}
              </pre>
              <button
                onClick={() => copyToClipboard(errorModal.message)}
                className="absolute top-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
                title="Copy to clipboard"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-green-400">Copied!</span>
                  </>
                ) : (
                  <Copy className="w-4 h-4 text-gray-400" />
                )}
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setErrorModal(null)}
                className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
