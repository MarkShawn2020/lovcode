import { forwardRef, type ComponentPropsWithoutRef, type ImgHTMLAttributes } from "react";

interface AvatarProps extends ComponentPropsWithoutRef<"span"> {
  className?: string;
}

export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);
Avatar.displayName = "Avatar";

interface AvatarImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  className?: string;
}

export const AvatarImage = forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className = "", alt = "", ...props }, ref) => {
    return (
      <img
        ref={ref}
        alt={alt}
        className={`aspect-square h-full w-full object-cover ${className}`}
        {...props}
      />
    );
  }
);
AvatarImage.displayName = "AvatarImage";

interface AvatarFallbackProps extends ComponentPropsWithoutRef<"span"> {
  className?: string;
}

export const AvatarFallback = forwardRef<HTMLSpanElement, AvatarFallbackProps>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`flex h-full w-full items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);
AvatarFallback.displayName = "AvatarFallback";
