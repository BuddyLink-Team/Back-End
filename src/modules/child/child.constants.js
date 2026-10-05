export const CHILD_GENDERS = Object.freeze({
  BOY: 'boy',
  GIRL: 'girl',
  OTHER: 'other',
});

// Fields a parent may set on a child profile (parentId, isArchived... are server-controlled)
export const CHILD_EDITABLE_FIELDS = Object.freeze([
  'displayName',
  'dateOfBirth',
  'gender',
  'interests',
  'favoriteActivities',
  'personality',
]);
