.PHONY: help install dev build test lint format clean audit security docs docker-up docker-down

help:
	@echo "haggl Platform - Development Commands"
	@echo "===================================="
	@echo ""
	@echo "Setup:"
	@echo "  make install          Install all dependencies"
	@echo ""
	@echo "Development:"
	@echo "  make dev              Start development servers"
	@echo "  make dev-backend      Start backend only"
	@echo "  make dev-frontend     Start frontend only"
	@echo ""
	@echo "Build & Test:"
	@echo "  make build            Build for production"
	@echo "  make test             Run all tests"
	@echo "  make test-coverage    Run tests with coverage"
	@echo "  make test-watch       Watch mode for tests"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint             Run ESLint"
	@echo "  make lint-fix         Fix ESLint issues"
	@echo "  make format           Format code with Prettier"
	@echo "  make type-check       TypeScript type checking"
	@echo ""
	@echo "Security & Audits:"
	@echo "  make audit            npm audit dependencies"
	@echo "  make security         Security scan"
	@echo ""
	@echo "Documentation:"
	@echo "  make docs             Generate API documentation"
	@echo ""
	@echo "Docker:"
	@echo "  make docker-up        Start Docker containers"
	@echo "  make docker-down      Stop Docker containers"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean            Clean build artifacts"
	@echo "  make clean-all        Clean everything"

install:
	npm install
	cd backend && npm install
	cd frontend && npm install

dev:
	npm run dev

dev-backend:
	cd backend && npm run start:dev

dev-frontend:
	cd frontend && npm run dev

build:
	cd backend && npm run build
	cd frontend && npm run build

test:
	npm run test

test-coverage:
	npm run test:cov

test-watch:
	npm run test:watch

lint:
	npm run lint

lint-fix:
	npm run lint:fix

format:
	npm run format

type-check:
	cd backend && npm run typeorm:migrations:generate
	tsc --noEmit

audit:
	npm audit

security:
	npm audit --audit-level=moderate

docs:
	cd backend && npm run swagger:generate

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

clean:
	rm -rf dist coverage .next
	cd backend && rm -rf dist coverage
	cd frontend && rm -rf .next coverage

clean-all: clean
	rm -rf node_modules backend/node_modules frontend/node_modules
	rm -rf package-lock.json backend/package-lock.json frontend/package-lock.json
