import { inject } from '@angular/core';
import { CanMatchFn, Route, UrlSegment } from '@angular/router';
import { map } from 'rxjs';
import { TagService } from '../services/tag.service';

/**
 * Route guard that checks if the tag in the route is a "Lego" tag.
 * Used to determine whether to show the Lego/collectible view or the note view.
 */
export const LegoTagGuard: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const tagService = inject(TagService);

  // Get tagId from the first segment
  const tagId = segments[0]?.path;
  if (!tagId) {
    return false;
  }

  // Check if tags are already loaded
  const currentTags = tagService.tags();
  if (currentTags.length > 0) {
    const tag = currentTags.find((t) => t._id === tagId);
    return tag?.label?.toLowerCase() === 'lego';
  }

  // Tags not loaded - trigger load and wait for result
  return tagService.loadTags().pipe(
    map((tags) => {
      const tag = tags.find((t) => t._id === tagId);
      return tag?.label?.toLowerCase() === 'lego';
    }),
  );
};

/**
 * Inverse guard - matches when tag is NOT a Lego tag
 */
export const NotLegoTagGuard: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const tagService = inject(TagService);

  const tagId = segments[0]?.path;
  if (!tagId) {
    return true; // No tag means it's the root, show note view
  }

  // Check if tags are already loaded
  const currentTags = tagService.tags();
  if (currentTags.length > 0) {
    const tag = currentTags.find((t) => t._id === tagId);
    return tag?.label?.toLowerCase() !== 'lego';
  }

  // Tags not loaded - trigger load and wait for result
  return tagService.loadTags().pipe(
    map((tags) => {
      const tag = tags.find((t) => t._id === tagId);
      return tag?.label?.toLowerCase() !== 'lego';
    }),
  );
};
