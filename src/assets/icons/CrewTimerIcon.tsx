import { SvgIcon, SvgIconProps } from '@mui/material';

export interface IconProps extends SvgIconProps {}

// Icon created from crewtimer-icon.svg exported from inkscape as optimized svg and
// converted to component via https://mui-svg-converter.vercel.app/
const Icon = (props: IconProps) => {
  return (
    <SvgIcon {...props}>
      <g fill="currentColor" strokeWidth="1.313">
        <path d="M11.525 4.315c0-1.488 1.445-2.694 3.228-2.694 1.784 0 3.23 1.206 3.23 2.694 0 1.487-1.446 2.693-3.23 2.693-1.783 0-3.228-1.206-3.228-2.693ZM8.747 8.113l13.986 4.717-.77.904-15.022-2.978zm-6.083 9.385 11.108-3.094 4.195-.034 1.376 1.481 3.524 5.31h-1.644l-3.49-4.277-3.66-.069-7.685 4.347H.216z" />
        <path
          fillRule="evenodd"
          d="m22.936 12.955.77.288-7.744 9.331-1.058-.048z"
        />
      </g>
    </SvgIcon>
  );
};

export default Icon;
