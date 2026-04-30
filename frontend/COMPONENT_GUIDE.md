# UI Components & Hooks Guide

This document describes all the new UI components and hooks added for improved user experience.

## Table of Contents
1. [Toast Notifications](#toast-notifications)
2. [Form Validation](#form-validation)
3. [Navigation Components](#navigation-components)
4. [Data Display](#data-display)
5. [Feedback Components](#feedback-components)
6. [Utilities & Hooks](#utilities--hooks)

---

## Toast Notifications

Display temporary notifications to users (success, error, warning, info).

### Setup
Wrap your app with `ToastProvider` in your root layout:

```tsx
import { ToastProvider } from '@/lib/hooks/useToast';
import { ToastContainer } from '@/components/ui/Toast';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </body>
    </html>
  );
}
```

### Usage

```tsx
import { useToast } from '@/lib/hooks/useToast';

function MyComponent() {
  const { addToast } = useToast();

  const handleSave = async () => {
    try {
      await api.post('/data', { /* data */ });
      addToast('Saved successfully!', 'success');
    } catch (error) {
      addToast('Failed to save', 'error');
    }
  };

  return <button onClick={handleSave}>Save</button>;
}
```

**Toast Types:**
- `success` - Green checkmark
- `error` - Red alert icon
- `warning` - Yellow warning icon
- `info` - Blue info icon

---

## Form Validation

Comprehensive form validation with real-time error feedback.

### useForm Hook

```tsx
import { useForm } from '@/lib/hooks/useForm';
import { validators } from '@/lib/utils/validation';
import { FormInput } from '@/components/ui/FormInput';
import { useToast } from '@/lib/hooks/useToast';

function LoginForm() {
  const { addToast } = useToast();
  const { values, errors, touched, isSubmitting, handleChange, handleBlur, handleSubmit } = useForm({
    initialValues: {
      email: '',
      password: '',
    },
    validationSchema: {
      email: validators.email,
      password: validators.password,
    },
    onSubmit: async (values) => {
      await api.post('/login', values);
      addToast('Logged in!', 'success');
    },
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormInput
        type="email"
        name="email"
        label="Email"
        placeholder="user@example.com"
        value={values.email}
        onChange={handleChange}
        onBlur={handleBlur}
        error={touched.email ? errors.email : undefined}
        required
      />
      <FormInput
        type="password"
        name="password"
        label="Password"
        placeholder="••••••••"
        value={values.password}
        onChange={handleChange}
        onBlur={handleBlur}
        error={touched.password ? errors.password : undefined}
        hint="At least 8 characters with uppercase and numbers"
        required
      />
      <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
        {isSubmitting ? 'Logging in...' : 'Log in'}
      </button>
    </form>
  );
}
```

### Available Validators

```tsx
// Built-in validators
validators.email
validators.username
validators.password
validators.url
validators.number
validators.required

// Custom validators
validators.minLength(5)      // Minimum length
validators.maxLength(20)     // Maximum length
validators.minValue(0)       // Minimum number
validators.maxValue(100)     // Maximum number

// Custom validation function
const customValidator = (value) => {
  if (value === 'invalid') return 'This value is not allowed';
  return null;
};
```

---

## Navigation Components

### Breadcrumb

Show navigation path:

```tsx
import { Breadcrumb } from '@/components/ui/Breadcrumb';

function ProductPage() {
  return (
    <>
      <Breadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Products', href: '/products' },
          { label: 'Laptop', active: true },
        ]}
      />
      {/* Page content */}
    </>
  );
}
```

### Tooltip

Show contextual help:

```tsx
import { Tooltip } from '@/components/ui/Tooltip';

function SettingsPage() {
  return (
    <div>
      <label>
        Advanced Mode
        <Tooltip content="Enable advanced features for power users" side="top" />
      </label>
    </div>
  );
}
```

---

## Data Display

### DataTable

Display sortable data in table format:

```tsx
import { DataTable } from '@/components/ui/DataTable';

function UsersPage() {
  const users = [
    { id: '1', name: 'Alice', email: 'alice@example.com', status: 'active' },
    { id: '2', name: 'Bob', email: 'bob@example.com', status: 'inactive' },
  ];

  return (
    <DataTable
      columns={[
        { key: 'name', label: 'Name', sortable: true },
        { key: 'email', label: 'Email', sortable: true },
        {
          key: 'status',
          label: 'Status',
          render: (value) => (
            <span className={value === 'active' ? 'text-green-400' : 'text-red-400'}>
              {value}
            </span>
          ),
        },
      ]}
      data={users}
      rowKey="id"
      onRowClick={(row) => console.log('Clicked:', row)}
      emptyMessage="No users found"
    />
  );
}
```

### Pagination

Navigate through paginated data:

```tsx
import { Pagination } from '@/components/ui/Pagination';
import { useState } from 'react';

function ProductsPage() {
  const [page, setPage] = useState(1);

  return (
    <>
      <div className="space-y-4">
        {/* Display current page items */}
      </div>
      <Pagination
        currentPage={page}
        totalPages={10}
        onPageChange={setPage}
        isLoading={false}
      />
    </>
  );
}
```

### SearchFilter

Search with suggestions and filtering:

```tsx
import { SearchFilter } from '@/components/ui/SearchFilter';
import { useState } from 'react';

function MarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<string[]>([]);

  return (
    <SearchFilter
      placeholder="Search agents..."
      onSearch={setSearchQuery}
      onFilterChange={setFilters}
      suggestions={['AI Agent', 'API', 'Bot', 'Tool']}
      filters={[
        { id: 'verified', label: 'Verified Only' },
        { id: 'popular', label: 'Most Popular' },
        { id: 'new', label: 'New' },
      ]}
    />
  );
}
```

---

## Feedback Components

### EmptyState

Display when no content is available:

```tsx
import { EmptyState } from '@/components/ui/EmptyState';
import { Package } from 'lucide-react';

function EmptyCart() {
  return (
    <EmptyState
      icon={Package}
      title="Your cart is empty"
      description="Add items to get started"
      action={{
        label: 'Continue Shopping',
        href: '/products',
      }}
    />
  );
}
```

### SkeletonLoader

Show loading state with content shape:

```tsx
import { SkeletonLoader, CardSkeletonLoader, ListSkeletonLoader } from '@/components/ui/SkeletonLoader';

// Generic skeleton
<SkeletonLoader count={3} shape="rect" height="200px" />

// Card grid skeleton
<CardSkeletonLoader count={6} />

// List skeleton
<ListSkeletonLoader count={5} />

// Table skeleton
<TableSkeletonLoader rows={5} cols={4} />
```

---

## Utilities & Hooks

### Custom Validation

Create custom validation rules:

```tsx
import { validateForm } from '@/lib/utils/validation';

const errors = validateForm(
  { username: 'ab', email: 'invalid' },
  {
    username: (val) => val.length < 3 ? 'Too short' : null,
    email: (val) => !val.includes('@') ? 'Invalid email' : null,
  }
);
```

---

## CSS Classes for Micro-interactions

New CSS classes automatically applied for smooth interactions:

- **Button hover effects**: Cards lift on hover
- **Loading animations**: Shimmer effect on skeleton loaders
- **Input focus**: Subtle scale animation
- **Page transitions**: Smooth fade and slide
- **Touch targets**: 44px minimum on mobile
- **Accessibility**: Respects `prefers-reduced-motion`

---

## Migration Guide

### Updating existing forms:
```tsx
// Before: Manual state management
const [email, setEmail] = useState('');
const [error, setError] = useState('');

// After: Use useForm hook
const { values, errors, handleChange, handleSubmit } = useForm({ /* ... */ });
```

### Adding notifications:
```tsx
// Before: Manual toast implementation
showNotification('Success');

// After: Use Toast system
const { addToast } = useToast();
addToast('Success', 'success');
```

### Replacing empty states:
```tsx
// Before: Manual empty state HTML
<div>No data</div>

// After: Use EmptyState component
<EmptyState title="No Data" description="Add items to get started" />
```

---

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Accessibility: WCAG 2.1 Level AA
- Mobile: Touch-friendly targets (44px minimum)
- Reduced motion: Respects user preferences

---

## Animation & Interaction Components

### Animated Counter

Display animated statistics with smooth counting:

```tsx
import { AnimatedCounter, CountUp } from '@/components/ui/AnimatedCounter';

// Animates on scroll into viewport
<AnimatedCounter value={2847} />

// With suffix and formatting
<AnimatedCounter value={243} suffix="K ETH" />

// Always animates on mount
<CountUp value={98.7} suffix="%" decimals={1} duration={2.5} />
```

### Scroll Reveal Animations

Animate elements as they come into view:

```tsx
import { ScrollReveal, ScrollStagger, ScrollItem } from '@/components/ui/ScrollReveal';

// Single element
<ScrollReveal direction="up" delay={0.1}>
  <div>Content slides in from bottom</div>
</ScrollReveal>

// Multiple elements with stagger
<ScrollStagger staggerDelay={0.1}>
  <ScrollItem direction="left">Item 1</ScrollItem>
  <ScrollItem direction="left">Item 2</ScrollItem>
  <ScrollItem direction="left">Item 3</ScrollItem>
</ScrollStagger>
```

### Ripple Button

Interactive button with ripple effect:

```tsx
import { RippleButton } from '@/components/ui/RippleButton';

<RippleButton variant="primary" size="md" loading={isLoading}>
  Click me
</RippleButton>

// With icon
<RippleButton variant="secondary" icon={<Heart />}>
  Add to favorites
</RippleButton>
```

**Variants:** primary, secondary, outline, ghost
**Sizes:** sm, md, lg

### Animated Heading

Beautiful heading animations with gradient text:

```tsx
import { AnimatedHeading, WordReveal, CharReveal } from '@/components/ui/AnimatedHeading';

// Gradient heading
<AnimatedHeading 
  gradient 
  gradientFrom="#a78bfa" 
  gradientTo="#06b6d4"
>
  Welcome to haggl
</AnimatedHeading>

// Word-by-word reveal
<WordReveal 
  text="Build, deploy, and earn" 
  highlightWords={["deploy"]}
/>

// Character-by-character
<CharReveal text="Amazing" duration={0.05} />
```

### Progress Bar

Loading indicator that appears during route transitions:

```tsx
import { ProgressBar } from '@/components/ui/ProgressBar';

<ProgressBar isLoading={isLoading} duration={3} color="from-purple-500 to-cyan-400" />
```

### Enhanced Tooltip

Contextual help with smooth animations:

```tsx
import { EnhancedTooltip } from '@/components/ui/EnhancedTooltip';

<EnhancedTooltip content="API keys manage your agent access" side="top">
  <button>API Keys</button>
</EnhancedTooltip>
```

**Sides:** top, bottom, left, right

### Stats Showcase

Display platform statistics with animated counters:

```tsx
import { StatsShowcase } from '@/components/sections/StatsShowcase';

<StatsShowcase />
```

---

## Best Practices

1. **Always use Toast for feedback** instead of native alerts
2. **Validate forms client-side** for better UX
3. **Use EmptyStates** when lists are empty
4. **Provide loading states** with SkeletonLoaders
5. **Add Tooltips** to complex features
6. **Use Breadcrumbs** for nested navigation
7. **Make all tables sortable** for data discovery
8. **Use Pagination** for large datasets
9. **Wrap content with ScrollReveal** for entrance animations
10. **Use AnimatedCounter** for stats and metrics
11. **Use RippleButton** for primary CTAs
12. **Use AnimatedHeading** for section titles

