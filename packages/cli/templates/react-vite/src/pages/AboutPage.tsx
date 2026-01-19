export default function AboutPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">About</h1>
      <p className="text-muted-foreground">
        This application was generated with blissful-infra.
      </p>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Features</h2>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>React 18 with TypeScript</li>
          <li>Vite for fast development</li>
          <li>TailwindCSS for styling</li>
          <li>React Query for data fetching</li>
          <li>Zustand for state management</li>
          <li>React Router for navigation</li>
          <li>WebSocket support for real-time updates</li>
        </ul>
      </div>
    </div>
  )
}
