import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActiveUsersListComponent, type ActiveUser } from '../active-users-list.component';

describe('ActiveUsersListComponent', () => {
  let component: ActiveUsersListComponent;
  let fixture: ComponentFixture<ActiveUsersListComponent>;

  const mockUsers: ActiveUser[] = [
    { name: 'Alice Smith', color: '#FF6B6B', userId: 'user-1' },
    { name: 'Bob Jones', color: '#4ECDC4', userId: 'user-2' },
    { name: 'Charlie Brown', color: '#45B7D1', userId: 'user-3' },
    { name: 'David Lee', color: '#FFA07A', userId: 'user-4' },
    { name: 'Eve Wilson', color: '#98D8C8', userId: 'user-5' },
    { name: 'Frank Miller', color: '#F7DC6F', userId: 'user-6' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActiveUsersListComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ActiveUsersListComponent);
    component = fixture.componentInstance;
  });

  describe('initialization', () => {
    it('should create component', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize with empty users array', () => {
      expect(component.users()).toEqual([]);
    });

    it('should have default maxVisible of 5', () => {
      expect(component.maxVisible()).toBe(5);
    });
  });

  describe('rendering', () => {
    it('should not render anything when no users are present', () => {
      fixture.detectChanges();
      const userList = fixture.nativeElement.querySelector('.active-users-list');
      expect(userList).toBeNull();
    });

    it('should render user avatars when users are present', () => {
      fixture.componentRef.setInput('users', mockUsers.slice(0, 3));
      fixture.detectChanges();

      const avatars = fixture.nativeElement.querySelectorAll('.user-avatar');
      expect(avatars.length).toBe(3);
    });

    it('should display user initials in avatars', () => {
      fixture.componentRef.setInput('users', [mockUsers[0]]);
      fixture.detectChanges();

      const initials = fixture.nativeElement.querySelector('.user-initials');
      expect(initials.textContent).toBe('AS'); // Alice Smith -> AS
    });

    it('should apply user color to avatar background', () => {
      fixture.componentRef.setInput('users', [mockUsers[0]]);
      fixture.detectChanges();

      const avatar = fixture.nativeElement.querySelector('.user-avatar');
      expect(avatar.style.backgroundColor).toBe('rgb(255, 107, 107)'); // #FF6B6B
    });

    it('should show user name in title attribute', () => {
      fixture.componentRef.setInput('users', [mockUsers[0]]);
      fixture.detectChanges();

      const avatar = fixture.nativeElement.querySelector('.user-avatar');
      expect(avatar.getAttribute('title')).toBe('Alice Smith');
    });
  });

  describe('maxVisible limit', () => {
    it('should show only maxVisible users', () => {
      fixture.componentRef.setInput('users', mockUsers);
      fixture.componentRef.setInput('maxVisible', 3);
      fixture.detectChanges();

      const avatars = fixture.nativeElement.querySelectorAll('.user-avatar:not(.remaining-count)');
      expect(avatars.length).toBe(3);
    });

    it('should show remaining count when users exceed maxVisible', () => {
      fixture.componentRef.setInput('users', mockUsers); // 6 users
      fixture.componentRef.setInput('maxVisible', 3);
      fixture.detectChanges();

      const remainingCount = fixture.nativeElement.querySelector('.remaining-count');
      expect(remainingCount).not.toBeNull();
      expect(remainingCount.textContent).toContain('+3'); // 6 - 3 = 3
    });

    it('should not show remaining count when all users fit', () => {
      fixture.componentRef.setInput('users', mockUsers.slice(0, 3));
      fixture.componentRef.setInput('maxVisible', 5);
      fixture.detectChanges();

      const remainingCount = fixture.nativeElement.querySelector('.remaining-count');
      expect(remainingCount).toBeNull();
    });
  });

  describe('getInitials method', () => {
    it('should get initials from single name', () => {
      expect(component.getInitials('Alice')).toBe('A');
    });

    it('should get initials from first and last name', () => {
      expect(component.getInitials('Alice Smith')).toBe('AS');
    });

    it('should get first two initials from multi-word name', () => {
      expect(component.getInitials('Alice Jane Smith')).toBe('AJ');
    });

    it('should convert to uppercase', () => {
      expect(component.getInitials('alice smith')).toBe('AS');
    });
  });

  describe('computed properties', () => {
    it('should compute visibleUsers correctly', () => {
      fixture.componentRef.setInput('users', mockUsers);
      fixture.componentRef.setInput('maxVisible', 3);
      fixture.detectChanges();

      const visible = component.visibleUsers();
      expect(visible.length).toBe(3);
      expect(visible[0].name).toBe('Alice Smith');
    });

    it('should compute remainingCount correctly', () => {
      fixture.componentRef.setInput('users', mockUsers);
      fixture.componentRef.setInput('maxVisible', 4);
      fixture.detectChanges();

      expect(component.remainingCount()).toBe(2); // 6 - 4 = 2
    });

    it('should return 0 for remainingCount when all users are visible', () => {
      fixture.componentRef.setInput('users', mockUsers.slice(0, 3));
      fixture.componentRef.setInput('maxVisible', 5);
      fixture.detectChanges();

      expect(component.remainingCount()).toBe(0);
    });
  });
});
