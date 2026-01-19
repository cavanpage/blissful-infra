import { Outlet, Link } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <nav className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold">
            {{PROJECT_NAME}}
          </Link>
          <div className="flex gap-4">
            <Link to="/" className="hover:text-primary/80">
              Home
            </Link>
            <Link to="/about" className="hover:text-primary/80">
              About
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t py-4">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          Built with blissful-infra
        </div>
      </footer>
    </div>
  )
}
