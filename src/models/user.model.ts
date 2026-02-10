import bcrypt from "bcrypt";
import { db } from "../config/databaseConnection";
import { users } from "./../schemas/users.schema";
import { clientInformation } from "./../schemas/clientInformation.schema";
import { eq, ne, and, count } from "drizzle-orm";
import { ROLES, Role, isRole } from "../types/role";

/* ================================
   TYPES
================================ */

interface CreateUserInput {
  fullName: string;
  email: string;
  password: string;
  role?: Role;
  empId?: string | null;
  managerId?: number; // BIGINT
  officePhone?: string;
  personalPhone?: string;
  designation?: string;
  isSupervisor?: boolean;
}

interface UpdateUserInput {
  fullName?: string;
  email?: string;
  password?: string;
  role?: Role;
  empId?: string | null;
  managerId?: number | null;
  officePhone?: string;
  personalPhone?: string;
  designation?: string;
  isSupervisor?: boolean;
}

/* ================================
   CREATE USER
================================ */

export const createUser = async (
  data: CreateUserInput,
  createdByRole: Role
) => {
  if (!data.fullName || !data.email || !data.password) {
    throw new Error("Full name, email and password are required");
  }

  if (data.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  // normalize email to lowercase
  const email = data.email.toLowerCase().trim();

  const existingEmail = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingEmail.length > 0) {
    throw new Error("Email already exists");
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  // Normalize empId: convert empty strings to null to avoid unique constraint violations
  const normalizedEmpId = data.empId && data.empId.trim() !== "" ? data.empId.trim() : null;

  // optional employee id handling (support new PINT format and legacy EMP-XXXX)
  if (normalizedEmpId) {
    const empIdValue = normalizedEmpId.toUpperCase();
    if (!/^(PINT\d{5})$/.test(empIdValue)) {
      throw new Error("empId must match format 'PINT12345' or 'EMP-XXXX' (e.g., PINT41922)");
    }

    const existingEmp = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emp_id, empIdValue))
      .limit(1);

    if (existingEmp.length > 0) {
      throw new Error("Employee ID already exists");
    }

    // normalize to uppercase
    data.empId = empIdValue;
  } else {
    // Set to null if empty/whitespace
    data.empId = null;
  }

  let finalRole: Role = "counsellor";

  if (createdByRole === "admin" && data.role && isRole(data.role)) {
    finalRole = data.role;
  }

  if (finalRole === "counsellor" && !data.managerId) {
    throw new Error("Counsellor must be assigned to a manager");
  }

  if (finalRole !== "counsellor" && data.managerId) {
    throw new Error("Only counsellors can have managerId");
  }

  // Only managers can be supervisors
  if (data.isSupervisor && finalRole !== "manager") {
    throw new Error("Only managers can be supervisors");
  }

  // Normalize phone numbers: convert empty strings to null to avoid unique constraint violations
  const officePhone = data.officePhone && data.officePhone.trim() !== "" ? data.officePhone.trim() : null;
  const personalPhone = data.personalPhone && data.personalPhone.trim() !== "" ? data.personalPhone.trim() : null;
  const designation = data.designation && data.designation.trim() !== "" ? data.designation.trim() : null;

  // Validate phone number length (max 10 characters)
  if (officePhone && officePhone.length > 10) {
    throw new Error("Office phone must be 10 characters or less");
  }
  if (personalPhone && personalPhone.length > 10) {
    throw new Error("Personal phone must be 10 characters or less");
  }

  const [user] = await db
    .insert(users)
    .values({
      fullName: data.fullName,
      email: email,
      emp_id: data.empId || null, // Use || to convert empty strings to null
      passwordHash,
      role: finalRole,
      managerId: finalRole === "counsellor" ? data.managerId : null,
      officePhone,
      personalPhone,
      designation,
      isSupervisor: finalRole === "manager" ? (data.isSupervisor ?? false) : false,
    })
    .returning({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      managerId: users.managerId,
      isSupervisor: users.isSupervisor,
    });

  return user;
};

/* ================================
   GET ALL USERS (NO ADMIN)
================================ */

export const getAllUsers = async () => {
  return db
    .select({
      id: users.id,
      empId: users.emp_id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      officePhone: users.officePhone,
      personalPhone: users.personalPhone,
      managerId: users.managerId,
      designation: users.designation,
      isSupervisor: users.isSupervisor,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(ne(users.role, "admin"));
};

/* ================================
   UPDATE USER (ADMIN)
================================ */

export const updateUserByAdmin = async (
  userId: number,
  data: UpdateUserInput
) => {
  if (data.email) {
    const newEmail = data.email.toLowerCase().trim();

    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, newEmail), ne(users.id, userId)))
      .limit(1);

    if (existingEmail.length > 0) {
      throw new Error("Email already exists");
    }

    data.email = newEmail;
  }

  // Track if empId was originally provided and normalize it
  let normalizedEmpIdValue: string | null | undefined = undefined;
  if (data.empId !== undefined) {
    // Normalize empId: convert empty strings/whitespace to null to avoid unique constraint violations
    const normalizedEmpId = data.empId && data.empId.trim() !== "" ? data.empId.trim() : null;
    normalizedEmpIdValue = normalizedEmpId ? normalizedEmpId.toUpperCase() : null;

    if (normalizedEmpIdValue && !/^(PINT\d{5})$/.test(normalizedEmpIdValue)) {
      throw new Error("empId must match format 'PINT12345' or 'EMP-XXXX' (e.g., PINT41922 or EMP-0025)");
    }

    if (normalizedEmpIdValue) {
      const existingEmp = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.emp_id, normalizedEmpIdValue), ne(users.id, userId)))
        .limit(1);

      if (existingEmp.length > 0) {
        throw new Error("Employee ID already exists");
      }
    }
  }

  let passwordHash: string | undefined;

  if (data.password) {
    if (data.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    passwordHash = await bcrypt.hash(data.password, 10);
  }

  const [existingUser] = await db
    .select({
      role: users.role,
      managerId: users.managerId,
      empId: users.emp_id,
      isSupervisor: users.isSupervisor,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!existingUser) {
    throw new Error("User not found");
  }

  const finalRole = data.role ?? existingUser.role;

  const finalManagerId =
    data.managerId !== undefined ? data.managerId : existingUser.managerId;

  if (finalRole === "counsellor" && !finalManagerId) {
    throw new Error("Counsellor must have a manager");
  }

  if (finalRole !== "counsellor" && finalManagerId) {
    throw new Error("Only counsellors can have managerId");
  }

  // Only managers can be supervisors
  if (data.isSupervisor !== undefined && finalRole !== "manager") {
    throw new Error("Only managers can be supervisors");
  }

  // Determine final isSupervisor value
  let finalIsSupervisor: boolean | undefined = undefined;
  if (data.isSupervisor !== undefined) {
    finalIsSupervisor = finalRole === "manager" ? data.isSupervisor : false;
  } else if (finalRole === "manager") {
    // Keep existing value if role remains manager
    finalIsSupervisor = existingUser.isSupervisor;
  } else {
    // If role changed from manager to something else, set to false
    finalIsSupervisor = false;
  }

  try {
    const [updatedUser] = await db
      .update(users)
      .set({
        fullName: data.fullName,
        email: data.email,
        passwordHash,
        role: finalRole,
        emp_id:
          normalizedEmpIdValue !== undefined
            ? normalizedEmpIdValue
            : existingUser.empId,
        managerId: finalRole === "counsellor" ? finalManagerId : null,
        officePhone: data.officePhone,
        personalPhone: data.personalPhone,
        designation: data.designation,
        isSupervisor: finalIsSupervisor ?? false,
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        role: users.role,
        managerId: users.managerId,
        isSupervisor: users.isSupervisor,
      });

    return updatedUser;
  } catch (err: any) {
    // Map Postgres unique constraint violations to friendly errors
    if (err?.code === "23505") {
      const constraint = String(err.constraint ?? err.detail ?? err.message ?? "");

      if (/emp(_|\b|\.)?id/i.test(constraint) || /emp_id/i.test(constraint)) {
        throw new Error("Employee ID already exists");
      }

      if (/email/i.test(constraint)) {
        throw new Error("Email already exists");
      }

      throw new Error("Unique constraint violation");
    }

    throw err;
  }
};

/* ================================
   DELETE USER (ADMIN)
================================ */

export const deleteUserByAdmin = async (
  targetUserId: number,
  adminUserId: number
) => {
  if (targetUserId === adminUserId) {
    throw new Error("Admin cannot delete own account");
  }

  const [existingUser] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, targetUserId));

  if (!existingUser) {
    throw new Error("User not found");
  }

  if (existingUser.role === "manager") {
    const counsellors = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.managerId, targetUserId));

    if (counsellors.length > 0) {
      throw new Error("Manager has assigned counsellors");
    }
  }

  await db.delete(users).where(eq(users.id, targetUserId));

  return { message: "User deleted successfully" };
};

/* ================================
   GET MANAGERS (DROPDOWN)
================================ */

export const getAllManagers = async () => {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      isSupervisor: users.isSupervisor,
    })
    .from(users)
    .where(eq(users.role, "manager"));
};

// Get all counsellors
export const getAllCounsellors = async () => {
  // Get all counsellors with their client counts
  const counsellorsWithClientCount = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      managerId: users.managerId,
      clientCount: count(clientInformation.clientId),
    })
    .from(users)
    .leftJoin(clientInformation, eq(users.id, clientInformation.counsellorId))
    .where(eq(users.role, "counsellor"))
    .groupBy(users.id, users.fullName, users.email, users.managerId);

  return counsellorsWithClientCount;
};

// Get counsellor by id
export const getCounsellorById = async (counsellorId: number) => {
  const counsellor = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, counsellorId));
  if (!counsellor.length) {
    return null;
  }
  return counsellor[0];
};

/* ================================
   GET COUNSELLORS BY MANAGER ID
================================ */

export const getCounsellorsByManagerId = async (managerId: number) => {
  // Verify manager exists
  const [manager] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      isSupervisor: users.isSupervisor,
    })
    .from(users)
    .where(eq(users.id, managerId));

  if (!manager) {
    throw new Error("Manager not found");
  }

  if (manager.role !== "manager") {
    throw new Error("User is not a manager");
  }

  // If supervisor, get ALL counsellors; otherwise, get only this manager's counsellors
  const whereCondition = manager.isSupervisor
    ? eq(users.role, "counsellor")
    : and(eq(users.role, "counsellor"), eq(users.managerId, managerId));

  // Get counsellors with their client counts
  const counsellorsWithClientCount = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      empId: users.emp_id,
      managerId: users.managerId,
      officePhone: users.officePhone,
      personalPhone: users.personalPhone,
      designation: users.designation,
      clientCount: count(clientInformation.clientId),
      isSupervisor: users.isSupervisor,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(clientInformation, eq(users.id, clientInformation.counsellorId))
    .where(whereCondition)
    .groupBy(
      users.id,
      users.fullName,
      users.email,
      users.emp_id,
      users.managerId,
      users.officePhone,
      users.personalPhone,
      users.designation,
      users.isSupervisor,
      users.role,
      users.createdAt
    );

  return {
    manager: {
      id: manager.id,
      fullName: manager.fullName,
      isSupervisor: manager.isSupervisor,
    },
    counsellors: counsellorsWithClientCount,
    count: counsellorsWithClientCount.length,
  };
};

/* ================================
   GET MANAGERS WITH THEIR COUNSELLORS (HIERARCHICAL VIEW)
================================ */

export const getManagersWithCounsellors = async () => {
  // Get all managers
  const allManagers = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      empId: users.emp_id,
      officePhone: users.officePhone,
      personalPhone: users.personalPhone,
      designation: users.designation,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.role, "manager"));

  // For each manager, get their counsellors
  const managersWithCounsellors = await Promise.all(
    allManagers.map(async (manager) => {
      const counsellors = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          empId: users.emp_id,
          managerId: users.managerId,
          officePhone: users.officePhone,
          personalPhone: users.personalPhone,
          designation: users.designation,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.role, "counsellor"), eq(users.managerId, manager.id)));

      return {
        ...manager,
        counsellors,
        counsellorCount: counsellors.length,
      };
    })
  );

  return managersWithCounsellors;
};

/* ================================
   CHANGE PASSWORD (USER)
================================ */

export const changePassword = async (
  userId: number,
  oldPassword: string,
  newPassword: string
) => {
  // Validate inputs
  if (!oldPassword || !newPassword) {
    throw new Error("Old password and new password are required");
  }

  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters");
  }

  // Get current user with password hash
  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  // Verify old password matches
  const isOldPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!isOldPasswordValid) {
    throw new Error("Current password is incorrect");
  }

  // Check if new password is different from old password
  const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSamePassword) {
    throw new Error("New password must be different from current password");
  }

  // Hash new password
  const newPasswordHash = await bcrypt.hash(newPassword, 10);

  // Update password in database
  await db
    .update(users)
    .set({
      passwordHash: newPasswordHash,
    })
    .where(eq(users.id, userId));

  return {
    message: "Password changed successfully",
    userId: user.id,
    email: user.email,
  };
};