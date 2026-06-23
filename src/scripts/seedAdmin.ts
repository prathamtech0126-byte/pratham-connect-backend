import "dotenv/config";
import bcrypt from "bcrypt";
import { db } from "../config/databaseConnection";
import { users } from "./../schemas/users.schema";
import { ensureSystemRoles, replaceUserPrimaryRoleLink } from "../utils/rbacSync";

async function seedAdmin() {
  const email = "admin@pratham";
  const password = "Pratham@419";

  const hashedPassword = await bcrypt.hash(password, 10);

  const [created] = await db
    .insert(users)
    .values({
      fullName: "Super Admin",
      email,
      emp_id: null,
      designation: "Super Admin",
      officePhone: null,
      personalPhone: null,
      passwordHash: hashedPassword,
      role: "admin",
      managerId: null,
    })
    .returning({ id: users.id });

  if (created) {
    await ensureSystemRoles(db);
    await replaceUserPrimaryRoleLink(db, created.id, "admin");
  }

  console.log("✅ Admin user created");
  console.log("📧 Email:", email);
  console.log("🔑 Password:", password);

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("❌ Failed to seed admin:", err);
  process.exit(1);
});