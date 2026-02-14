import { useQuery } from '@tanstack/react-query'
import { useWebSocket } from '@/hooks/useWebSocket'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

interface HealthResponse {
  status: string
  timestamp: string
}

interface HelloResponse {
  message: string
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('Failed to fetch health')
  return res.json()
}

async function fetchHello(name?: string): Promise<HelloResponse> {
  const url = name ? `/api/hello/${name}` : '/api/hello'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch hello')
  return res.json()
}

export default function HomePage() {
  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  })

  const { data: hello, isLoading: helloLoading } = useQuery({
    queryKey: ['hello'],
    queryFn: () => fetchHello(),
  })

  const { messages, connected } = useWebSocket('/ws/events')

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-bold mb-4">Welcome to {"{{PROJECT_NAME}}"}</h1>
        <p className="text-muted-foreground">
          Your full-stack application is ready to go.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <Card.Header>
            <Card.Title>API Health</Card.Title>
          </Card.Header>
          <Card.Content>
            {healthLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : health ? (
              <div className="space-y-2">
                <p>
                  Status:{' '}
                  <span className={health.status === 'healthy' ? 'text-green-600' : 'text-red-600'}>
                    {health.status}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(health.timestamp).toLocaleString()}
                </p>
              </div>
            ) : (
              <p className="text-red-600">API unavailable</p>
            )}
          </Card.Content>
          <Card.Footer>
            <Button onClick={() => refetchHealth()} variant="outline" size="sm">
              Refresh
            </Button>
          </Card.Footer>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>Hello API</Card.Title>
          </Card.Header>
          <Card.Content>
            {helloLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : hello ? (
              <p className="text-lg">{hello.message}</p>
            ) : (
              <p className="text-red-600">Failed to load</p>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Header>
            <Card.Title>WebSocket Events</Card.Title>
          </Card.Header>
          <Card.Content>
            <div className="space-y-2">
              <p>
                Status:{' '}
                <span className={connected ? 'text-green-600' : 'text-yellow-600'}>
                  {connected ? 'Connected' : 'Disconnected'}
                </span>
              </p>
              <div className="max-h-32 overflow-y-auto text-sm">
                {messages.length === 0 ? (
                  <p className="text-muted-foreground">No events yet</p>
                ) : (
                  messages.slice(-5).map((msg, i) => (
                    <p key={i} className="text-muted-foreground truncate">
                      {msg}
                    </p>
                  ))
                )}
              </div>
            </div>
          </Card.Content>
        </Card>
      </div>
    </div>
  )
}
