// ============================================================
//  FacultyPulse — Department / program vocabulary (single source)
//  sections.department holds a DEGREE PROGRAM code (BEED, BSA, BSED, BSHM,
//  BSIT, BSInfoTech, BSTM, PEU). users.department holds an ORG DEPARTMENT
//  code (Agri, HTM, ICT, IT, TEd). One department can cover several
//  programs. Programs with NO owning department (PEU = general ed / PE, or
//  anything unmapped) are treated as "minor / general" courses.
// ============================================================

export const ORG_DEPARTMENTS = ["Agri", "HTM", "ICT", "IT", "TEd"];

// Display names — cosmetic only; the code ("IT") is what is stored/compared.
export const ORG_DEPARTMENT_NAMES = {
  Agri: "Agriculture",
  HTM:  "Hospitality & Tourism Management",
  ICT:  "Information & Communications Technology",
  IT:   "Information Technology",
  TEd:  "Teacher Education",
};

export const PROGRAM_TO_ORG_DEPARTMENT = {
  BEED: "TEd", BSED: "TEd",
  BSHM: "HTM", BSTM: "HTM",
  BSIT: "IT",
  BSInfoTech: "ICT",
  BSA: "Agri",
};

export const orgDepartmentOf = (program) => PROGRAM_TO_ORG_DEPARTMENT[program] || null;
export const departmentLabel = (code) =>
  ORG_DEPARTMENT_NAMES[code] ? `${code} — ${ORG_DEPARTMENT_NAMES[code]}` : code;
