-- Codigo de la empresa (para identificarla), prefijo de sus empleados y consecutivo del ultimo numero usado
ALTER TABLE "companies"
  ADD COLUMN "code" VARCHAR(9),
  ADD COLUMN "employee_code_prefix" CHAR(3),
  ADD COLUMN "employee_sequence" INTEGER NOT NULL DEFAULT 0;

-- Relleno de las empresas que ya existen: codigos aleatorios sin caracteres ambiguos, unicos
DO $$
DECLARE
  company RECORD;
  code_alphabet CONSTANT text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  prefix_alphabet CONSTANT text := 'ABCDEFGHJKMNPQRSTVWXYZ';
  new_code text;
  new_prefix text;
  i integer;
BEGIN
  FOR company IN SELECT id FROM companies ORDER BY created_at, id LOOP
    LOOP
      new_code := '';
      FOR i IN 1..8 LOOP
        new_code := new_code || substr(code_alphabet, 1 + floor(random() * length(code_alphabet))::integer, 1);
        IF i = 4 THEN new_code := new_code || '-'; END IF;
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE code = new_code);
    END LOOP;
    LOOP
      new_prefix := '';
      FOR i IN 1..3 LOOP
        new_prefix := new_prefix || substr(prefix_alphabet, 1 + floor(random() * length(prefix_alphabet))::integer, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM companies WHERE employee_code_prefix = new_prefix);
    END LOOP;
    UPDATE companies SET code = new_code, employee_code_prefix = new_prefix WHERE id = company.id;
  END LOOP;
END $$;

-- Los empleados existentes reciben su numero consecutivo por orden de alta; los codigos escritos a mano se reemplazan
UPDATE employees SET employee_code = NULL;
UPDATE employees e
SET employee_code = c.employee_code_prefix || '-' || lpad(n.position::text, 4, '0')
FROM companies c,
     (SELECT id, row_number() OVER (PARTITION BY company_id ORDER BY created_at, id) AS position FROM employees) n
WHERE n.id = e.id AND c.id = e.company_id;
UPDATE companies c
SET employee_sequence = (SELECT count(*) FROM employees e WHERE e.company_id = c.id);

ALTER TABLE "companies" ALTER COLUMN "code" SET NOT NULL, ALTER COLUMN "employee_code_prefix" SET NOT NULL;
ALTER TABLE "employees" ALTER COLUMN "employee_code" SET NOT NULL;

CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");
CREATE UNIQUE INDEX "companies_employee_code_prefix_key" ON "companies"("employee_code_prefix");

ALTER TABLE "companies" ADD CONSTRAINT "companies_code_format" CHECK (code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$');
ALTER TABLE "companies" ADD CONSTRAINT "companies_employee_code_prefix_format" CHECK (employee_code_prefix ~ '^[A-Z]{3}$');
ALTER TABLE "companies" ADD CONSTRAINT "companies_employee_sequence_positive" CHECK (employee_sequence >= 0);
ALTER TABLE "employees" ADD CONSTRAINT "employees_employee_code_format" CHECK (employee_code ~ '^[A-Z]{3}-[0-9]{4,}$');

-- Los identificadores no cambian nunca y el consecutivo solo sube, para que un numero no se reutilice
CREATE FUNCTION "companies_identifiers_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.employee_code_prefix IS DISTINCT FROM OLD.employee_code_prefix THEN
    RAISE EXCEPTION 'companies_identifiers_immutable: el codigo y el prefijo de la empresa no cambian';
  END IF;
  IF NEW.employee_sequence < OLD.employee_sequence THEN
    RAISE EXCEPTION 'companies_identifiers_immutable: el consecutivo de empleados solo sube';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "companies_identifiers_immutable"
BEFORE UPDATE ON "companies"
FOR EACH ROW EXECUTE FUNCTION "companies_identifiers_immutable"();

CREATE FUNCTION "employees_code_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_code IS DISTINCT FROM OLD.employee_code THEN
    RAISE EXCEPTION 'employees_code_immutable: el codigo de un empleado no cambia';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employees_code_immutable"
BEFORE UPDATE ON "employees"
FOR EACH ROW EXECUTE FUNCTION "employees_code_immutable"();
