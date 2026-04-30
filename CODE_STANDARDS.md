# haggl Platform - Code Standards & Guidelines

## 🎯 Code Quality Standards

This document outlines the professional code standards for the haggl platform to ensure SaaS-grade quality.

---

## 📋 TypeScript Standards

### 1. Strict Mode (Always Enabled)

```typescript
// ✅ CORRECT
interface User {
  id: string;
  email: string;
  createdAt: Date;
}

const getUser = (id: string): User | null => {
  // Implementation
};

// ❌ INCORRECT
const user: any = { id: 1 };
const data = getUser(id);  // Missing return type
```

### 2. No `any` Type

```typescript
// ✅ CORRECT
const parseJson = <T,>(json: string): T => {
  return JSON.parse(json) as T;
};

// ❌ INCORRECT
const parseJson = (json: string): any => {
  return JSON.parse(json);
};
```

### 3. Explicit Return Types

```typescript
// ✅ CORRECT
export const fetchUser = async (id: string): Promise<User> => {
  return api.get(`/users/${id}`);
};

// ❌ INCORRECT
export const fetchUser = async (id: string) => {
  return api.get(`/users/${id}`);
};
```

### 4. Error Handling

```typescript
// ✅ CORRECT
try {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) {
    throw new NotFoundError(`User ${id} not found`);
  }
  return user;
} catch (error) {
  logger.error('Failed to fetch user', { id, error });
  throw error;
}

// ❌ INCORRECT
const user = await db.user.findUnique({ where: { id } });
return user;  // Could be undefined
```

---

## 🚫 Forbidden Patterns

### No Console Statements
```typescript
// ❌ NEVER DO THIS
console.log('User created');
console.error('Something went wrong');

// ✅ USE LOGGER INSTEAD
logger.info('User created', { userId });
logger.error('Failed to create user', { error });
```

### No Loose Equality
```typescript
// ❌ BAD
if (status == 'active') { }

// ✅ GOOD
if (status === 'active') { }
```

### No Floating Promises
```typescript
// ❌ BAD
asyncFunction();  // Promise not awaited

// ✅ GOOD
await asyncFunction();
// OR
void asyncFunction();  // Explicitly intended
```

### No Any Types
```typescript
// ❌ BAD
const data: any = { };

// ✅ GOOD
interface Data {
  id: string;
}
const data: Data = { id: '123' };
```

---

## 🏗️ NestJS Backend Standards

### Service Layer Pattern

```typescript
// user.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new NotFoundException(`User ${id} not found`);
      }

      return user;
    } catch (error) {
      this.logger.error('Failed to find user', { id, error });
      throw error;
    }
  }
}
```

### Controller Best Practices

```typescript
// user.controller.ts
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  async getUser(@Param('id') id: string): Promise<UserDto> {
    return this.userService.findById(id);
  }
}
```

### Validation DTOs

```typescript
// create-user.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  displayName!: string;
}
```

---

## ⚛️ React/Frontend Standards

### Component Structure

```typescript
// ✅ CORRECT
import { FC, useState } from 'react';
import { motion } from 'framer-motion';

interface UserProfileProps {
  userId: string;
  onClose: () => void;
}

export const UserProfile: FC<UserProfileProps> = ({
  userId,
  onClose,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUser(userId);
  }, [userId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      {/* Content */}
    </motion.div>
  );
};
```

### Hooks Usage

```typescript
// ✅ CORRECT
export const useUser = (id: string): {
  user: User | null;
  loading: boolean;
  error: Error | null;
} => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const data = await fetchUser(id);
        setUser(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  return { user, loading, error };
};
```

---

## 📝 Documentation Standards

### JSDoc Comments

```typescript
/**
 * Fetches a user by ID from the database
 * 
 * @param id - The user's unique identifier
 * @returns Promise resolving to the user object
 * @throws NotFoundException when user is not found
 * @example
 * const user = await userService.findById('user-123');
 */
export async function findById(id: string): Promise<User> {
  // Implementation
}
```

### README Structure

```markdown
# Module Name

## Overview
Brief description of what this module does.

## Installation
npm install

## Usage
```

### Commit Messages

```
feat: Add user authentication
fix: Resolve memory leak in WebSocket handler
refactor: Simplify error handling in service
test: Add unit tests for user service
docs: Update API documentation
style: Format code with Prettier
chore: Update dependencies
```

---

## 🧪 Testing Standards

### Unit Test Structure

```typescript
// user.service.spec.ts
describe('UserService', () => {
  let service: UserService;
  let prisma: PrismaService;

  beforeEach(async () => {
    // Setup
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      // Arrange
      const userId = 'test-123';
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);

      // Act
      const result = await service.findById(userId);

      // Assert
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user not found', async () => {
      // Arrange
      jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      // Act & Assert
      await expect(service.findById('invalid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
```

### Coverage Requirements

- **Overall:** 70% minimum
- **Critical paths:** 80% minimum
- **Utils:** 90% minimum

---

## 🔐 Security Standards

### Never Commit Secrets

```
# ❌ NEVER
DATABASE_URL=postgresql://user:password@host:5432/db
API_KEY=sk-1234567890

# ✅ USE .env.local (in .gitignore)
```

### Input Validation

```typescript
// ✅ CORRECT
import { validate } from 'class-validator';

const createUserDto = new CreateUserDto();
createUserDto.email = 'user@example.com';

const errors = await validate(createUserDto);
if (errors.length > 0) {
  throw new BadRequestException('Invalid input');
}
```

### SQL Injection Prevention

```typescript
// ✅ CORRECT - Using Prisma (parameterized)
const user = await prisma.user.findUnique({
  where: { email }
});

// ❌ WRONG - Raw queries
const user = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

---

## 🎨 Code Organization

### Directory Structure

```
backend/
├── src/
│   ├── common/           # Shared utilities
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── logger/
│   ├── modules/          # Feature modules
│   │   ├── auth/
│   │   ├── users/
│   │   └── market/
│   └── main.ts
├── test/                 # Test files
├── tsconfig.json
└── jest.config.js

frontend/
├── src/
│   ├── app/              # Pages
│   ├── components/       # Reusable components
│   │   ├── layout/
│   │   ├── ui/
│   │   └── sections/
│   ├── lib/              # Utilities
│   │   ├── api/
│   │   ├── hooks/
│   │   └── utils/
│   └── styles/
├── __tests__/            # Test files
├── jest.config.js
└── tsconfig.json
```

---

## ✅ Pre-commit Checklist

Before committing code:

- [ ] TypeScript strict mode passes
- [ ] No `any` types used
- [ ] No console statements
- [ ] ESLint passes (`npm run lint`)
- [ ] Prettier formatted (`npm run format`)
- [ ] Unit tests written and passing
- [ ] No hardcoded secrets
- [ ] JSDoc comments added
- [ ] Commit message follows convention

---

## 🚀 Performance Standards

- No synchronous operations in async functions
- No memory leaks in subscriptions/listeners
- Lazy load components when possible
- Cache frequently accessed data
- Paginate large datasets
- Use proper logging levels (info, warn, error)

---

## 📞 Questions?

Refer to the main README.md or open an issue.

Last Updated: April 9, 2026
