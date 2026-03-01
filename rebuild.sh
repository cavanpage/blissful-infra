npm --prefix packages/cli run build
npm --prefix packages/dashboard run build
docker build -f Dockerfile.dashboard -t blissful-infra-dashboard:latest .
