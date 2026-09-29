export class ChildResponseDTO {
  static toResponse(child) {
    if (!child) return null;

    // Calculate approximate age from dateOfBirth
    let age = null;
    if (child.dateOfBirth) {
      const birthDate = new Date(child.dateOfBirth);
      const diffMs = Date.now() - birthDate.getTime();
      const ageDt = new Date(diffMs);
      age = Math.abs(ageDt.getUTCFullYear() - 1970);
    }

    return {
      id: child._id,
      parentId: child.parentId,
      displayName: child.displayName,
      dateOfBirth: child.dateOfBirth,
      age,
      gender: child.gender,
      interests: child.interests || [],
      favoriteActivities: child.favoriteActivities || [],
      personality: child.personality || [],
      createdAt: child.createdAt,
      updatedAt: child.updatedAt,
    };
  }

  static toResponseList(children) {
    if (!Array.isArray(children)) return [];
    return children.map((c) => ChildResponseDTO.toResponse(c));
  }
}
