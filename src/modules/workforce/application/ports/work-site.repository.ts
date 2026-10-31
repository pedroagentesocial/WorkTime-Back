export interface WorkSiteView {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewWorkSite {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number;
}

export interface WorkSitePatch {
  readonly name?: string | undefined;
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
  readonly radiusMeters?: number | undefined;
  readonly active?: boolean | undefined;
}

export interface WorkSiteRepository {
  list(companyId: string): Promise<WorkSiteView[]>;
  findById(companyId: string, id: string): Promise<WorkSiteView | null>;
  insert(companyId: string, site: NewWorkSite): Promise<WorkSiteView>;
  update(companyId: string, id: string, patch: WorkSitePatch): Promise<void>;
  // Bloquea la fila de la empresa y cuenta sus zonas, para decidir sin carreras
  lockAndCount(companyId: string): Promise<{ total: number; active: number } | null>;
}
