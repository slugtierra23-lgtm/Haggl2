# Image Optimization Guide

This guide outlines best practices for optimizing images in the haggl frontend.

## Principles

1. **Use Next.js Image component** - Automatic optimization, responsive sizing
2. **Lazy load non-critical images** - Use `loading="lazy"` attribute
3. **Async decoding** - Use `decoding="async"` to avoid blocking rendering
4. **Proper alt text** - Always provide descriptive alt text for accessibility
5. **Responsive sizes** - Use srcSet and sizes for responsive images

## Implementation

### For Critical Images (Hero, Above-fold)
```tsx
<img
  src="/hero-image.png"
  alt="Hero section description"
  loading="eager"
  decoding="async"
  width={1920}
  height={1080}
/>
```

### For Non-Critical Images (Below-fold, Thumbnails)
```tsx
<img
  src="/thumbnail.png"
  alt="Item thumbnail"
  loading="lazy"
  decoding="async"
  width={150}
  height={150}
/>
```

### Using the useOptimizedImage Hook
```tsx
import { useOptimizedImage } from '@/lib/hooks/useOptimizedImage';

function MyComponent() {
  const { isLoading, imageProps } = useOptimizedImage({
    src: '/image.png',
    alt: 'Description',
    priority: false,
  });

  return (
    <div>
      {isLoading && <div>Loading...</div>}
      <img {...imageProps} />
    </div>
  );
}
```

## Migration Checklist

- [ ] Replace `<img>` with optimized attributes
- [ ] Add `loading="lazy"` to non-critical images
- [ ] Add `loading="eager"` to above-fold images
- [ ] Add `decoding="async"` to all images
- [ ] Verify alt text is descriptive
- [ ] Test with Next.js Image component where applicable
- [ ] Monitor bundle size and image delivery

## Performance Targets

- First Contentful Paint (FCP): < 1.5s
- Cumulative Layout Shift (CLS): < 0.1
- Image delivery: < 100KB for thumbnails, < 500KB for heros
